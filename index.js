#!/usr/bin/env node

var minimist = require('minimist');
//var Client = require('node-ssdp').Client;
var internalIp = require('internal-ip');
var getPort = require('get-port');
var fs = require('fs');
var http = require('http');
var rangeParser = require('range-parser');
var keypress = require('keypress');
var mime = require('mime');
var path = require('path');
var noop = function () {};
var opts = minimist(process.argv.slice(2));
var MediaRendererClient = require('upnp-mediarenderer-client');

var RendererFinder = require('./libs/RendererFinder');

if (!opts._.length && !opts.listRenderer) {
  console.log('Usage: dlnacast [--type <mime>] [--address <tv-ip>] [-s <file>] <file>');
  console.log('Usage: dlnacast --listRenderer');
  process.exit();
}

var discover = function (autoStop) {
  var rf = new RendererFinder();

  var clean = function () {
    rf.stop();
    clearTimeout(to);
  };
  var to = null;

  to = setTimeout(function () {
    clean();
  }, 50000);

  if (autoStop){
    rf.once('found', function (argument) {
      clean();
    });
  }

  rf.start();

  return rf;
};


function DIDLMetadata(url, type, title, subtitle) {
  var DIDL = '';
  DIDL = DIDL + '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:sec="http://www.sec.co.kr/">';
  DIDL = DIDL + '  <item id="f-0" parentID="0" restricted="0">';
  DIDL = DIDL + '    <dc:title>' + title + '</dc:title>';
  if (subtitle){
    DIDL = DIDL + '    <sec:CaptionInfo sec:type="srt">' + subtitle + '</sec:CaptionInfo>';
    DIDL = DIDL + '    <sec:CaptionInfoEx sec:type="srt">' + subtitle + '</sec:CaptionInfoEx>';
    DIDL = DIDL + '    <res protocolInfo="http-get:*:text/srt:*">' + subtitle +'</res>';
  }
  DIDL = DIDL + '    <upnp:class>object.item.videoItem</upnp:class>';
  DIDL = DIDL + '    <res protocolInfo="http-get:*:' + type + ':DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000" sec:URIType="public">' + url +'</res>';
  DIDL = DIDL + '  </item>';
  DIDL = DIDL + '</DIDL-Lite>';
  return DIDL;
}

function StaticContent(filePath, cb, relatedUrl){
  var stat = fs.statSync(filePath);
  var total = stat.size;
  var type = opts.type || mime.lookup(filePath);
  var url = '';
  getPort(function(err, port){
    if (err) {
      console.log(err);
      process.exit();
    }

    var url = 'http://' + internalIp() + ':' + port;
    var server = http.createServer(function (req, res) {
      var range = req.headers.range;

      res.setHeader('Content-Type', type);
      res.setHeader('Access-Control-Allow-Origin', '*');
      //res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('transferMode.dlna.org', 'Streaming');
      if (relatedUrl){
        res.setHeader('CaptionInfo.sec', relatedUrl);
      }
      res.setHeader('contentFeatures.dlna.org', 'DLNA.ORG_PN=AVC_MP4_HP_HD_AAC;DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000');

      if (!range) {
        res.setHeader('Content-Length', total);
        res.statusCode = 200;
        return fs.createReadStream(filePath).pipe(res);
      }

      var part = rangeParser(total, range)[0];
      var chunksize = (part.end - part.start) + 1;
      var file = fs.createReadStream(filePath, {start: part.start, end: part.end});

      res.setHeader('Content-Range', 'bytes ' + part.start + '-' + part.end + '/' + total);

      res.setHeader('Content-Length', chunksize);
      res.statusCode = 206;

      return file.pipe(res);
    });
    server.listen(port);
    cb(url);
  });
}



if (opts.listRenderer){
  discover(false).on('found', function(info, msg){
    console.log('Device: ' + msg.Location);
  });
}else{
  discover(true).once('found', function (info, msg) {
    var loc = msg.Location;
    var filePath = opts._[0];
    var subtitlePath = opts.s;

    StaticContent(subtitlePath ? subtitlePath : filePath, function(firstUrl){
      if (subtitlePath){
        StaticContent(filePath, function(secondUrl){
          runDLNA(secondUrl, firstUrl);
        }, firstUrl);
      }else{
        runDLNA(firstUrl);
      }
    });

    function runDLNA(fileUrl, subUrl){
      var cli = new MediaRendererClient(loc);
      var stat = fs.statSync(filePath);
      var total = stat.size;
      var type = opts.type || mime.lookup(filePath);
      var isPlaying = false;

      if (!opts.type && type === 'video/x-matroska') {
        type = 'video/x-mkv';
      }

      keypress(process.stdin);
      process.stdin.setRawMode(true);
      process.stdin.resume();

      cli.load(fileUrl, {
        autoplay: true,
        contentType: type,
        metadata: DIDLMetadata(fileUrl, type, path.basename(filePath), subUrl)
      }, function (err, result) {
        if (err) {
          console.log(err.message);
          //process.exit();
        }
        console.log('playing: ', filePath);
        console.log('use your space-key to toggle between play and pause');
      });

      cli.on('playing', function () {
        isPlaying = true;
      });

      cli.on('paused', function () {
        isPlaying = false;
      });

      process.stdin.on('keypress', function (ch, key) {
        if (key && key.name && key.name === 'space') {
          if (isPlaying) {
            cli.pause();
          } else {
            cli.play();
          }
        }

        if (key && key.ctrl && key.name === 'c') {
          process.exit();
        }
      });
    }

  });
}
