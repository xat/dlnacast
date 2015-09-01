var dgram = require('dgram');
var util = require("util");
var events = require("events");


function RendererFinder(ST){
  events.EventEmitter.call(this);
  var that = this;
  var message = new Buffer(
  	"M-SEARCH * HTTP/1.1\r\n" +
  	"HOST:239.255.255.250:1900\r\n" +
  	"MAN:\"ssdp:discover\"\r\n" +
  	"ST: " + (ST || "urn:schemas-upnp-org:device:MediaRenderer:1") + "\r\n" +
    //"ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n" +
  	"MX:2\r\n" +
  	"\r\n"
  );
  var client = null;
  var server = null;


  this.stop = function(){
    if (server)
      server.close();
    if (client && client._handle)
      client.close();
  };

  this.start = function(){
    client = dgram.createSocket("udp4");
    client.bind(); // So that we get a port so we can listen before sending

    client.send(message, 0, message.length, 1900, "239.255.255.250", function(){

      server = dgram.createSocket("udp4");

    	server.on("message", function (msg, rinfo) {
        that.emit('found', rinfo, parseMsg(msg));
    	});

    	server.bind(client.address().port); // Bind to the random port we were given when sending the message, not 1900

      client.close();
    });

  };


  function parseMsg(buffer){
    var response = {};
    var parts = buffer.toString().split('\r\n');
    for (var i = 0; i < parts.length; i++){
      if (i > 0){
        response[parts[i].split(': ')[0]] = parts[i].split(': ')[1];
      }else{
        response.Status = parts[i];
      }
    }
    return response;
  }
}

util.inherits(RendererFinder, events.EventEmitter);


module.exports = RendererFinder;
