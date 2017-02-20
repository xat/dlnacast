#!/usr/bin/env node

var minimist = require('minimist')
var RendererFinder = require('renderer-finder')
var fs = require('fs')
var keypress = require('keypress')
var mime = require('mime')
var opts = minimist(process.argv.slice(2))
var MediaRendererClient = require('upnp-mediarenderer-client')
var smfs = require('static-file-server')
var path = require('path')

function DIDLMetadata (url, type, title, subtitle) {
  var DIDL = ''
  DIDL = DIDL + '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:sec="http://www.sec.co.kr/">'
  DIDL = DIDL + '  <item id="f-0" parentID="0" restricted="0">'
  DIDL = DIDL + '    <dc:title>' + title + '</dc:title>'
  if (subtitle) {
    DIDL = DIDL + '    <sec:CaptionInfo sec:type="srt">' + subtitle + '</sec:CaptionInfo>'
    DIDL = DIDL + '    <sec:CaptionInfoEx sec:type="srt">' + subtitle + '</sec:CaptionInfoEx>'
    DIDL = DIDL + '    <res protocolInfo="http-get:*:text/srt:*">' + subtitle + '</res>'
  }
  DIDL = DIDL + '    <upnp:class>object.item.videoItem</upnp:class>'
  DIDL = DIDL + '    <res protocolInfo="http-get:*:' + type + ':DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000" sec:URIType="public">' + url + '</res>'
  DIDL = DIDL + '  </item>'
  DIDL = DIDL + '</DIDL-Lite>'
  return DIDL
}

function runDLNA (cli, fileUrl, subUrl, type, name) {
  if (require.main === module) {
    keypress(process.stdin)
    process.stdin.setRawMode(true)
    process.stdin.resume()
  }
  var isPlaying = false

  cli.load(fileUrl, {
    autoplay: true,
    contentType: type,
    metadata: DIDLMetadata(fileUrl, type, name, subUrl)
  }, function (err, result) {
    if (err) {
      console.log(err.message)
      // process.exit()
    }
    console.log('playing: ', name)
    console.log('use your space-key to toggle between play and pause')
  })

  cli.on('playing', function () {
    isPlaying = true
  })

  cli.on('paused', function () {
    isPlaying = false
  })

  cli.on('stopped', function () {
    if (require.main === module) {
      process.exit()
    }
  })

  if (require.main === module) {
    process.stdin.on('keypress', function (ch, key) {
      if (key && key.name && key.name === 'space') {
        if (isPlaying) {
          cli.pause()
        } else {
          cli.play()
        }
      }

      if (key && key.ctrl && key.name === 'c') {
        process.exit()
      }
    })
  }
}

var discover = function (cb) {
  var finder = new RendererFinder()

  finder.findOne(function (err, info, msg) {
    clearTimeout(to)
    cb(err, msg.location)
  })

  var to = setTimeout(function () {
    finder.stop()
    clearTimeout(to)
    cb(new Error('device not found'))
  }, 5000)
}

var connect = function (address, cb) {
    if (address) {
      connect_prepare(null, address)
    } else {
      discover(connect_prepare)
    }
    function connect_prepare(err, loc) {
      if (err) {
        console.log(err)
        if (require.main === module) {
          process.exit()
        }
      }
      cli = new MediaRendererClient(loc)
      cb(cli)
    }
}

module.exports = {
  listRenderer: function (cb) {
    var finder = new RendererFinder()

    finder.on('found', function (info, msg, desc) {
      cb(undefined, info, msg, desc)
    })

    finder.on('error', function (err) {
      cb(err)
    })

    return finder.start(true)
  },
  //TODO: this does not work yet
  command: function(address, command) {
      connect(address, function (cli) {
          switch (command) {
              case 'play':
                  cli.play()
                  break
              case 'pause':
                  console.log('pause')
                  cli.pause()
                  break
              case 'stop':
                  cli.stop()
                  break
              default:
                  console.log('Error: unknown commmand')
                  process.exit(1)
                  break
          }
          process.exit()
      })
  },
  renderMedia: function (file, type, address, subtitle) {
    connect(address, function (cli) {
      var subtitlePath = subtitle
      var filePath = file
      type = type || fs.statSync(filePath).type || mime.lookup(filePath)
      var firstHeaders = {
        'Access-Control-Allow-Origin': '*',
        'transferMode.dlna.org': 'Streaming',
        'contentFeatures.dlna.org': 'DLNA.ORG_PN=AVC_MP4_HP_HD_AAC;DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000'
      }

      // If the is a subtitle to load, load that first and the the media
      // This is requires to provide the subtitle headers
      smfs.serve(subtitlePath ? subtitlePath : filePath, {
        headers: firstHeaders
      }, function (err, firstUrl) {
        if (err) {
          console.log(err)
          if (require.main === module) {
            process.exit()
          }
        }
        if (subtitlePath) {
          firstHeaders['CaptionInfo.sec'] = firstUrl
          smfs.serve(filePath, {
            headers: firstHeaders
          }, function (err, secondUrl) {
            if (err) {
              console.log(err)
              if (require.main === module) {
                process.exit()
              }
            }
            runDLNA(cli, secondUrl, firstUrl, type, path.basename(filePath))
          }, firstUrl)
        } else {
          runDLNA(cli, firstUrl, null, type, path.basename(filePath))
        }
      })
      return cli
    })
  },
  renderStream: function (url, type, address) {
    //TODO autodetect type?
    type = type || "audio/mpeg"
    connect(address, function (cli) {
      //TODO autodetect stream name?
      runDLNA(cli, url, null, type, "Stream")
    })
  }
}

// check if the module is called from a terminal of required from anothe module
if (require.main === module) {
  var address = opts.address ? opts.address : opts.a
  if (opts.command || opts.c) {
    module.exports.command(address, opts.command ? opts.command : opts.c)
  } else if (opts.listRenderer || opts.l) {
    module.exports.listRenderer(function (err, info, msg, desc) {
      if (err) {
        console.log(err)
        process.exit()
      }
      console.log(desc.device.friendlyName + ': ' + msg.location)
    })
  } else if (opts.stream) {
    module.exports.renderStream(opts.stream, opts.type, address)
  } else if (opts._.length) {
    module.exports.renderMedia(opts._[0], opts.type, address, opts.subtitle)
  } else {
    console.log('Usage: dlnacast [--type <mime>] [--address <tv-ip>] [--subtitle <file>] <file>')
    console.log('Usage: dlnacast [--type <mime>] [--address <tv-ip>] --stream <URL>')
    console.log('Usage: dlnacast --listRenderer')
    process.exit()
  }
}
