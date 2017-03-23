console.log("Loading sierra s3 item reader");

const avro = require('avsc');
const AWS = require('aws-sdk')
const crypto = require('crypto')
const kinesis = new AWS.Kinesis({region: 'us-east-1'})
const wrapper = require('sierra-wrapper')

//main function
exports.handler = function(event, context){
  var fs = require('fs'),
  JSONStream = require('JSONStream'),
  es = require('event-stream');

  var getStream = function () {
      var jsonData = 'items.ndjson',
          stream = fs.createReadStream(jsonData, {encoding: 'utf8'}),
          parser = JSONStream.parse();
          return stream.pipe(parser);
  };

   getStream()
    .pipe(es.mapSync(function (data) {
      kinesisHandler(data, context);
    }));
};

//kinesis stream handler
var kinesisHandler = function(record, context) {
  console.log('Processing ' + record );
  console.log(record);
  postItemsStream(record);
}

//get schema
var request = require('request');
var schema = function(url, context) {
  return new Promise(function(resolve, reject) {
    request(url, function(error, response, body) {
      if(!error && response.statusCode == 200){
        resolve(JSON.parse(body).data.schema);
      }else{
        console.log("An error occurred - " + response.statusCode);
        reject("Error occurred while getting schema - " + response.statusCode);
      }
    })
  })
}

//send data to kinesis Stream
var postItemsStream = function(item){
  const type = avro.infer(item);
  console.log(type.getSchema());
  const item_in_avro_format = type.toBuffer(item);
  console.log("Avro formatted item: " + item_in_avro_format);
  var params = {
    Data: item_in_avro_format, /* required */
    PartitionKey: crypto.randomBytes(20).toString('hex').toString(), /* required */
    StreamName: 'testS3ItemReader', /* required */
  }
  kinesis.putRecord(params, function (err, data) {
    if (err) console.log(err, err.stack) // an error occurred
    else     console.log(data)           // successful response
    //cb(null,data)
  })

}
