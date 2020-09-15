const _ = require('lodash')
const logger = require('../common/logger')
const helper = require('../common/helper')
const { userResources } = require('../common/constants')

/**
 * Process add message
 * @param {Object} message the kafka message
 * @param {String} transactionId
 */
async function processAdd (message, transactionId) {
  const membershipType = message.payload.membershipType
  if (membershipType === 'user') {
    const userResource = userResources['group']
    userResource.validate(message.payload)
    const { seqNo, primaryTerm, user } = await helper.getUser(message.payload.universalUID, transactionId)

    if (!user[userResource.propertyName]) {
      user[userResource.propertyName] = []
    }

    const relateId = message.payload[userResource.relateKey]
    if (_.some(user[userResource.propertyName], [userResource.relateKey, relateId])) {
      logger.error(`Can't create existed group with the ${userResource.relateKey}: ${relateId}, userId: ${message.payload.universalUID}`)
      throw helper.getErrorWithStatus('[version_conflict_engine_exception]', 409)
    } else {
      user[userResource.propertyName].push({
        id: message.payload.groupId,
        name: message.payload.name,
        createdAt: message.payload.createdAt,
        createdBy: message.payload.createdBy
      })
      await helper.updateUser(message.payload.universalUID, user, seqNo, primaryTerm, transactionId)
    }
  } else {
    logger.info(`Ignore this message since membershipType: '${membershipType}' is not 'user'`)
  }
}

/**
 * Process delete message
 * @param {Object} message the kafka message
 * @param {String} transactionId
 */
async function processDelete (message, transactionId) {
  const membershipType = message.payload.membershipType
  const userResource = userResources['group']
  userResource.validate(message.payload)
  const { seqNo, primaryTerm, user } = await helper.getUser(message.payload.universalUID, transactionId)

  const relateId = message.payload[userResource.relateKey]
  const groupId = 'id'

  // check the resource exist
  if (!user[userResource.propertyName] || !_.some(user[userResource.propertyName], [groupId, relateId])) {
    logger.error(`The group with the ${groupId}: ${relateId}, userId: ${message.payload.universalUID} not exist`)
    throw helper.getErrorWithStatus('[resource_not_found_exception]', 404)
  } else {
    _.remove(user[userResource.propertyName], [groupId, relateId])
    await helper.updateUser(message.payload.universalUID, user, seqNo, primaryTerm, transactionId)
  }
}

module.exports = {
  processAdd,
  processDelete
}

logger.buildService(module.exports)
