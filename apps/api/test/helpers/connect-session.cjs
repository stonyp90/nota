'use strict';
const { signToken, notaryIdForEmail, SCOPES } = require('../../src/notary-auth');
module.exports = email => ({ authorization: 'Bearer ' + signToken(notaryIdForEmail(email), Date.now() + 3600000, SCOPES.SESSION), 'content-type': 'application/json' });
