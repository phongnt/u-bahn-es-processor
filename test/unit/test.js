/**
 * Mocha tests of the UBahn ES Processor.
 */

process.env.NODE_ENV = 'test'
global.Promise = require('bluebird')
const _ = require('lodash')
const should = require('should')
const logger = require('../../src/common/logger')
const { topResources, userResources, organizationResources } = require('../../src/common/constants')
const service = require('../../src/services/ProcessorService')
const { fields, testTopics } = require('../common/testData')
const { getESRecord } = require('../common/testHelper')

describe('UBahn - Elasticsearch Data Processor Unit Test', () => {
  let infoLogs = []
  let errorLogs = []
  let debugLogs = []
  const info = logger.info
  const error = logger.error
  const debug = logger.debug

  /**
   * Assert validation error
   * @param err the error
   * @param message the message
   */
  const assertValidationError = (err, message) => {
    err.isJoi.should.be.true()
    should.equal(err.name, 'ValidationError')
    err.details.map(x => x.message).should.containEql(message)
    errorLogs.should.not.be.empty()
  }

  before(async () => {
    // inject logger with log collector
    logger.info = (message) => {
      infoLogs.push(message)
      info(message)
    }
    logger.debug = (message) => {
      debugLogs.push(message)
      debug(message)
    }
    logger.error = (message) => {
      errorLogs.push(message)
      error(message)
    }
  })

  after(async () => {
    // restore logger
    logger.error = error
    logger.info = info
    logger.debug = debug
  })

  beforeEach(() => {
    // clear logs
    infoLogs = []
    debugLogs = []
    errorLogs = []
  })

  for (const op of ['Create', 'Update', 'Delete']) {
    for (let i = 0; i < testTopics[op].length; i++) {
      const resource = _.upperFirst(testTopics[op][i].payload.resource)
      it(`process ${_.lowerFirst(op)} ${resource} success`, async () => {
        if (op === 'Delete' || (op === 'Update' && i < 11)) {
          // ensure document exist before delete or update
          try {
            await getESRecord(testTopics[op][i].payload)
          } catch (e) {
            throw new Error('should not throw error here')
          }
        }

        if (op !== 'Update' || i < 11) {
          await service[`process${op}`](testTopics[op][i])
        }

        if (op === 'Delete') {
          // ensure document not exist after delete
          try {
            await getESRecord(testTopics[op][i].payload)
            throw new Error('should not throw error here')
          } catch (e) {
            should.equal(e.statusCode, 404)
          }
        } else if (op !== 'Update' || i < 11) {
          const ret = await getESRecord(testTopics[op][i].payload)
          if (testTopics[op][i].payload.resource === 'user') {
            should.equal(ret.handle, testTopics[op][i].payload.handle)
          } else {
            should.deepEqual(ret, _.omit(testTopics[op][i].payload, 'resource'))
          }
        }
      })

      if (op === 'Update' && i >= 11) {
        // ensure document doesn't exist before update
        // when perform update operation later, it will throw error
        it(`failure - process update ${resource} with document doesn't exist`, async () => {
          try {
            await service[`process${op}`](testTopics[op][i])
            throw new Error('should not throw error here')
          } catch (e) {
            should.equal(e.statusCode, 404)
          }
        })
      }

      if (op === 'Create') {
        it(`failure - process create ${resource} with duplicate id`, async () => {
          try {
            await service.processCreate(testTopics[op][i])
            throw new Error('should not throw error here')
          } catch (e) {
            should.equal(e.statusCode, 409)
          }
        })
      }

      if (op === 'Delete') {
        it(`failure - process delete ${resource} not found`, async () => {
          try {
            await service.processDelete(testTopics[op][i])
            throw new Error('should not throw error here')
          } catch (e) {
            should.equal(e.statusCode, 404)
            if (topResources[_.lowerFirst(resource)]) {
              should.equal(e.message, 'Not Found')
            } else {
              should.equal(e.message, '[resource_not_found_exception]')
            }
          }
        })
      }
    }

    for (const resourceKey in fields) {
      const messageIndex = fields[resourceKey][`${_.lowerFirst(op)}Index`]
      // there is not update role test data
      if (!messageIndex || op !== 'Update') {
        continue
      }
      for (const requiredField of fields[resourceKey].requiredFields) {
        it(`test process ${_.lowerFirst(op)} ${resourceKey} message with invalid parameters, required field ${requiredField} is missing`, async () => {
          let message = _.cloneDeep(testTopics[op][messageIndex])
          message = _.omit(message, requiredField)
          try {
            await service[`process${op}`](message)
            throw new Error('should not throw error here')
          } catch (err) {
            assertValidationError(err, `"${_.last(requiredField.split('.'))}" is required`)
          }
        })
        if (requiredField !== 'payload.resource') {
          it(`test process ${_.lowerFirst(op)} ${resourceKey} message with invalid parameters, invalid string field ${requiredField}`, async () => {
            const message = _.cloneDeep(testTopics[op][messageIndex])
            _.set(message, requiredField, '12345')
            try {
              await service[`process${op}`](message)
              throw new Error('should not throw error here')
            } catch (err) {
              assertValidationError(err, `"${_.last(requiredField.split('.'))}" must be a valid GUID`)
            }
          })
        }
      }
    }

    it(`test process ${_.lowerFirst(op)} message with incorrect resource, message is ignored`, async () => {
      const message = _.cloneDeep(testTopics[op][0])
      message.payload.resource = 'invalid'
      await service[`process${op}`](message)
      should.equal(_.last(infoLogs), `Ignore this message since resource is not in [${_.union(_.keys(topResources), _.keys(userResources), _.keys(organizationResources))}]`)
    })
  }
})
