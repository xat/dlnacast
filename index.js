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
  renderMedia: function (file, type, address, subtitle) {
    var cli = null

    if (address) {
      startSender(null, address)
    } else {
      discover(startSender)
    }

    function startSender (err, loc) {
      if (err) {
        console.log(err)
        if (require.main === module) {
          process.exit()
        }
      }
      cli = new MediaRendererClient(loc)
      var subtitlePath = subtitle
      var filePath = file
      var stat = fs.statSync(filePath)
      stat.type = stat.type || mime.lookup(filePath)
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
            runDLNA(secondUrl, firstUrl, stat)
          }, firstUrl)
        } else {
          runDLNA(firstUrl, null, stat)
        }
      })

      function runDLNA (fileUrl, subUrl, stat) {
        if (require.main === module) {
          keypress(process.stdin)
          process.stdin.setRawMode(true)
          process.stdin.resume()
        }
        var isPlaying = false

        cli.load(fileUrl, {
          autoplay: true,
          contentType: stat.type,
          metadata: DIDLMetadata(fileUrl, stat.type, path.basename(filePath), subUrl)
        }, function (err, result) {
          if (err) {
            console.log(err.message)
            // process.exit()
          }
          console.log('playing: ', path.basename(filePath))
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
      return cli
    }
  }
}

// check if the module is called from a terminal of required from anothe module
if (require.main === module) {
  if (!opts._.length && !opts.listRenderer) {
    console.log('Usage: dlnacast [--type <mime>] [--address <tv-ip>] [--subtitle <file>] <file>')
    console.log('Usage: dlnacast --listRenderer')
    process.exit()
  }

  if (opts.listRenderer) {
    module.exports.listRenderer(function (err, info, msg, desc) {
      if (err) {
        console.log(err)
        process.exit()
      }
      console.log(desc.device.friendlyName + ': ' + msg.location)
    })
  } else {
    module.exports.renderMedia(opts._[0], opts.type, opts.address, opts.subtitle)
  }
}
