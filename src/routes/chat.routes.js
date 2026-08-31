const express = require('express');
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/chat.controller');

const router = express.Router();

router.use(protect);
router.get('/conversations', ctrl.myConversations);
router.post('/conversations', ctrl.openConversation);
router.post('/inquiry', ctrl.openInquiry);
router.get('/conversations/:id/messages', ctrl.messages);
router.post('/conversations/:id/messages', ctrl.sendMessage);

module.exports = router;
