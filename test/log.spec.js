const mockConsole = require('jest-mock-console')
const { log, noop } = require('../lib/log')

describe('log', () => {
  let restoreConsole
  beforeAll(() => { restoreConsole = mockConsole() })
  afterAll(() => restoreConsole())
  afterEach(() => jest.clearAllMocks())
  it('logs messages to the console preceded by the identifier "cerberus"', () => {
    log('test')
    expect(console.log).toHaveBeenCalled()
    expect(console.log.mock.calls[0][0]).toEqual(expect.stringContaining('cerberus'))
    expect(console.log.mock.calls[0][1]).toEqual(expect.stringContaining('test'))
  })
  describe('noop', () => {
    it('doesn\'t log messages', () => {
      noop('test')
      expect(console.log).not.toHaveBeenCalled()
    })
  })
})
