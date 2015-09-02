#!/usr/bin/env node

var minimist = require('minimist');
var Client = require('node-ssdp').Client;
var internalIp = require('internal-ip');
var getPort = require('get-port');
var fs = require('fs');
var http = require('http');
var rangeParser = require('range-parser');
var keypress = require('keypress');
var mime = require('mime');
var noop = function () {};
var opts = minimist(process.argv.slice(2));
var MediaRendererClient = require('upnp-mediarenderer-client');

if (!opts._.length) {
  console.log('Usage: dlnacast [--type <mime>] [--address <tv-ip>] <file>');
  process.exit();
}

var discover = function (cb) {
  var cli = new Client();

  if (!cb) cb = noop;

  var clean = function () {
    cli.removeListener('response', onResponse);
    cli._stop();
    clearTimeout(to);
  };

  var to = setTimeout(function () {
    clean();
    cb(new Error('device not found'));
  }, 5000);

  var onResponse = function (meta, status, machine) {
    if (opts.address && opts.address !== machine.address)
      return;
    clean();
    cb(null, meta.LOCATION);
  };

  cli.on('response', onResponse);
  cli.search('urn:schemas-upnp-org:device:MediaRenderer:1');
};

discover(function (err, loc) {
  if (err) {
    console.log(err);
    process.exit();
  }

  getPort(function (err, port) {
    if (err) {
      console.log(err);
      process.exit();
    }

    var cli = new MediaRendererClient(loc);
    var url = 'http://' + internalIp() + ':' + port;
    var filePath = opts._[0];
    var stat = fs.statSync(filePath);
    var total = stat.size;
    var type = opts.type || mime.lookup(filePath);
    var isPlaying = false;

    // Dirty hack to support MKV on my Samsung TV..
    // I have no idea if other TV manufactures also require this..
    if (!opts.type && type === 'video/x-matroska') {
      type = 'video/x-mkv';
    }

    keypress(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    var server = http.createServer(function (req, res) {
      var range = req.headers.range;

      res.setHeader('Content-Type', type);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('transferMode.dlna.org', 'Streaming');
      res.setHeader('contentFeatures.dlna.org', 'DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000');

      if (!range) {
        res.setHeader('Content-Length', total);
        res.statusCode = 200;
        return fs.createReadStream(filePath).pipe(res);
      }

      var part = rangeParser(total, range)[0];
      var chunksize = (part.end - part.start) + 1;
      var file = fs.createReadStream(filePath, {start: part.start, end: part.end});

      res.setHeader('Content-Range', 'bytes ' + part.start + '-' + part.end + '/' + total);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', chunksize);
      res.statusCode = 206;

      return file.pipe(res);
    });

    cli.load(url, { autoplay: true, contentType: type }, function (err, result) {
      if (err) {
        process.exit();
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

    server.listen(port);
  });

});
