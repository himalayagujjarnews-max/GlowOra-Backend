const express = require('express');
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/referral.controller');

const router = express.Router();

router.use(protect); // leaderboard needs to know "who's asking" for myRank

router.get('/leaderboard', ctrl.leaderboard);

module.exports = router;
