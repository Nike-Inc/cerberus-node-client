const log = (...args) => {
  console.log('cerberus-node', ...args)
}

const noop = () => { }

module.exports = {
  log,
  noop
}
