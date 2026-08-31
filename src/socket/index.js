/**
 * Socket.io real-time chat.
 * Auth via JWT in the handshake. Rooms are per-conversation.
 * Emits: 'message:new', 'typing', 'message:read'.
 */
const { Server } = require('socket.io');
const { verifyAccessToken } = require('../utils/jwt');
const config = require('../config/env');
const logger = require('../utils/logger');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Booking = require('../models/Booking');
const Staff = require('../models/Staff');
const { notifyUser } = require('../services/notification.service');

let io;

async function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: [config.cors.customerUrl, config.cors.partnerUrl, config.cors.adminUrl],
      credentials: true,
    },
  });

  // Redis adapter → lets chat work across MANY backend instances behind a
  // load balancer (a message from server A reaches a user connected to server B).
  // Skipped gracefully if Redis/adapter isn't available (single-server dev).
  try {
    const { createAdapter } = require('@socket.io/redis-adapter');
    const { createClient } = require('redis');
    const pubClient = createClient({ url: config.redisUrl });
    const subClient = pubClient.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    logger.info('✅ Socket.IO Redis adapter active (multi-server ready)');
  } catch (err) {
    logger.warn(`⚠️  Socket.IO Redis adapter not active (${err.message}) — single-server mode.`);
  }

  // auth middleware
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('Auth token required'));
      const decoded = verifyAccessToken(token);
      socket.userId = decoded.id;
      socket.role = decoded.role;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    logger.debug(`Socket connected: ${socket.userId}`);
    // personal room for direct notifications
    socket.join(`user:${socket.userId}`);

    socket.on('conversation:join', async (conversationId) => {
      const conv = await Conversation.findById(conversationId);
      if (!conv) return;
      const uid = socket.userId;
      if (conv.customer.toString() !== uid && (!conv.staff || conv.staff.toString() !== uid)) return;
      socket.join(`conv:${conversationId}`);
    });

    socket.on('message:send', async ({ conversationId, text, attachment }, cb) => {
      try {
        const conv = await Conversation.findById(conversationId).populate('booking', 'communicationUnlocked');
        if (!conv) return cb && cb({ error: 'Conversation not found' });
        const uid = socket.userId;
        const isParticipant = conv.customer.toString() === uid || (conv.staff && conv.staff.toString() === uid);
        if (!isParticipant) return cb && cb({ error: 'Not allowed' });
        if (conv.locked || (conv.booking && !conv.booking.communicationUnlocked)) {
          return cb && cb({ error: 'Conversation is closed' });
        }

        const isCustomer = conv.customer.toString() === uid;
        const message = await Message.create({
          conversation: conv._id,
          sender: uid,
          senderRole: isCustomer ? 'customer' : socket.role,
          text, attachment,
          type: attachment ? 'image' : 'text',
        });
        conv.lastMessage = text || '📷 Photo';
        conv.lastMessageAt = new Date();
        if (isCustomer) conv.unreadStaff += 1; else conv.unreadCustomer += 1;
        await conv.save();

        io.to(`conv:${conversationId}`).emit('message:new', message);

        // push to the other participant if offline-ish
        const otherId = isCustomer ? conv.staff : conv.customer;
        if (otherId) {
          notifyUser(otherId, {
            title: 'New message',
            body: text || 'Sent a photo',
            type: 'chat',
            data: { conversationId: conv._id.toString() },
          });
        }
        cb && cb({ ok: true, message });
      } catch (err) {
        logger.error(`socket message:send error: ${err.message}`);
        cb && cb({ error: 'Failed to send' });
      }
    });

    socket.on('typing', ({ conversationId, typing }) => {
      socket.to(`conv:${conversationId}`).emit('typing', { userId: socket.userId, typing });
    });

    socket.on('message:read', async ({ conversationId }) => {
      try {
        await Message.updateMany({ conversation: conversationId, sender: { $ne: socket.userId }, read: false }, { read: true });
        // The REST GET /messages endpoint resets conv.unread* when it marks
        // messages read, but this socket path (used live, while the chat
        // screen is already open) never did — so an unread badge on the
        // conversation list wouldn't clear until the next full reopen of the
        // thread. Mirror the REST behaviour here too.
        const conv = await Conversation.findById(conversationId);
        if (conv) {
          const isCustomer = conv.customer.toString() === socket.userId;
          if (isCustomer) conv.unreadCustomer = 0; else conv.unreadStaff = 0;
          await conv.save();
        }
        socket.to(`conv:${conversationId}`).emit('message:read', { by: socket.userId });
      } catch (err) {
        logger.error(`socket message:read error: ${err.message}`);
      }
    });

    // ---- Live stylist location tracking (home-service bookings) ----

    // Customer opens "Track stylist on map" → joins a per-booking room so they
    // receive location updates emitted by the stylist below.
    socket.on('booking:track:join', async (bookingId) => {
      try {
        const booking = await Booking.findById(bookingId);
        if (!booking) return;
        const uid = socket.userId;
        const staff = booking.staff ? await Staff.findById(booking.staff) : null;
        const isCustomer = booking.customer.toString() === uid;
        const isStaff = staff && staff.user && staff.user.toString() === uid;
        if (!isCustomer && !isStaff) return; // not a participant of this booking
        socket.join(`booking:${bookingId}`);
      } catch (err) {
        logger.error(`socket booking:track:join error: ${err.message}`);
      }
    });

    // Stylist's phone (partner app) emits its GPS position periodically while
    // en route to a home-service booking. We verify the sender is actually the
    // assigned stylist for that booking, then relay it to the customer's room.
    socket.on('booking:location:update', async ({ bookingId, latitude, longitude }) => {
      try {
        if (typeof latitude !== 'number' || typeof longitude !== 'number') return;
        const booking = await Booking.findById(bookingId);
        if (!booking || booking.mode !== 'home') return;
        if (!['confirmed', 'in_progress'].includes(booking.status)) return;

        const staff = booking.staff ? await Staff.findById(booking.staff) : null;
        const isAssignedStaff = staff && staff.user && staff.user.toString() === socket.userId;
        if (!isAssignedStaff) return; // ignore updates from anyone but the assigned stylist

        io.to(`booking:${bookingId}`).emit('booking:staff-location', {
          bookingId,
          latitude,
          longitude,
          at: new Date().toISOString(),
        });
      } catch (err) {
        logger.error(`socket booking:location:update error: ${err.message}`);
      }
    });

    socket.on('disconnect', () => logger.debug(`Socket disconnected: ${socket.userId}`));
  });

  return io;
}

function getIo() {
  return io;
}

module.exports = { initSocket, getIo };
