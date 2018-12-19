const log = () => {
  console.log.apply(console, ['cerberus-node'].concat(Array.prototype.slice.call(arguments)))
}

const noop = () => { }

module.exports = {
  log,
  noop
}
