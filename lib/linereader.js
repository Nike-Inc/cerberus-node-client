module.exports = {
  readLine: linereader
}

var readline = require('readline')

function linereader (options, cb) {
  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  rl.on('line', input => {
    rl.input.removeAllListeners('keypress')
    rl.close()
    return cb(null, input)
  })

  rl.on('SIGINT', function () {
    rl.input.removeAllListeners('keypress')
    rl.close()
    return cb('Prompt canceled')
  })

  if (options.replace) {
    process.stdin.on('keypress', (char) => {
      char = char + ''

      switch (char) {
        case '\n':
        case '\r':
        case '\u0004':
          process.stdin.pause()
          break
        default:
          process.stdout.write('\x1B[2K\x1B[200D' + options.prompt + Array(rl.line.length + 1).join(options.replace))
          break
      }
    })

    readline.emitKeypressEvents(process.stdin)
    if (process.stdin.isTTY) process.stdin.setRawMode(true)
  }

  rl.setPrompt(options.prompt)
  rl.prompt()
}
