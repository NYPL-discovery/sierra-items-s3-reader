console.log("Loading bulk export reader");

const avro = require('avsc');
const AWS = require('aws-sdk');
const crypto = require('crypto');
const kinesis = new AWS.Kinesis({region: 'us-east-1'});
const wrapper = require('sierra-wrapper');
const highland = require('highland');

var schema_stream_retriever = null;

//main function
exports.handler = function(event, context){
  JSONStream = require('JSONStream');
  var exps = [ {"exportFile": "items.ndjson","postStream": "ItemPostRequest","recordType": "item","apiSchema": "https://api.nypltech.org/api/v0.1/current-schemas/ItemPostRequest"}, {"exportFile": "items.ndjson","postStream": "BibPostRequest","recordType": "bib","apiSchema": "https://api.nypltech.org/api/v0.1/current-schemas/BibPostRequest"}]

  exps.forEach(function(exportFile) {
    var s3 = new AWS.S3({apiVersion: '2006-03-01'});
    var params = {Bucket: 'bulk-export-reader', Key: exportFile.exportFile };
    var getStream = function () {
      var data_array = [],
          idx = 0,
          loadIndex = 1;
      highland(s3.getObject(params).createReadStream())
        .split()
        .compact()
        .map(JSON.parse)
        .stopOnError((err, data) => {
          if(err) console.log('error occurred - ' + err.message)
        })
        .each((data) => {
          idx = idx + 1;
          data["nyplSource"] = "sierra-nypl";
          data["nyplType"] = exportFile.recordType;
          data_array.push(data);
          if (idx > 499) {
            idx = 0;
            kinesisHandler(loadIndex, data_array, context, exportFile);
            data_array = [];
          }
          loadIndex += 1;
        })
        .on('end', function () {
          kinesisHandler(data_array, context, exportFile); // once more for the last batch, whatever size it is.
          console.log(`Posting last ${idx} records. End of stream.`);
        });
    }

    getStream()

  });
};

//kinesis stream handler
var kinesisHandler = function(loadIndex, records, context, exportFile) {
  if(schema_stream_retriever === null){
    schema(exportFile.apiSchema)
    .then(function(schema_data){
      schema_stream_retriever = schema_data;
      setTimeout(() => {
       postKinesisStream(records, exportFile, schema_data);
      }, loadIndex)
    })
    .catch(function(e){
      console.log(records[0]);
      console.log(e, e.stack);
    });
  }else{
    setTimeout(() => {
      postKinesisStream(records, exportFile, schema_stream_retriever);
    }, 10)
  }
}

//get schema
var request = require('request');
var schema = function(url, context) {
  return new Promise(function(resolve, reject) {
    request(url, function(error, response, body) {
      if(!error && response.statusCode == 200){
        resolve(JSON.parse(body).data.schema);
      }else{
        console.log(`An error occurred ${response.statusCode}`);
        reject(`Error occurred while getting schema ${response.statusCode}`);
      }
    })
  })
}

var postedToKinesis = 0

//send data to kinesis Stream
var postKinesisStream = function(records, exportFile, schemaData){
  var avro_schema = avro.parse(schemaData);
  records_in_avro_format = []
  records.forEach(function(rec) {
    var amazon_hash = {
      Data: avro_schema.toBuffer(rec),
      PartitionKey: crypto.randomBytes(20).toString('hex').toString() /* required */
    }
    records_in_avro_format.push(amazon_hash);
  })
  var params = {
    Records: records_in_avro_format, /* required */
    StreamName: exportFile.postStream /* required */
  }
  /*console.log("Not posting records")
  console.log('Records to kinesis - ' + records_in_avro_format.length)*/
  kinesis.putRecords(params, function (err, data) {
    if (err) console.log(err, err.stack); // an error occurred
    else    {
      postedToKinesis += records_in_avro_format.length;
      console.log("Successfully posted to kinesis: " + postedToKinesis);           // successful response
    }
  })

}
