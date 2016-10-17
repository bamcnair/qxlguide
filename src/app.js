'use strict';
// set of constants that will create the conditions needed for the API.ai based chat bot to work

const apiai = require('apiai');
const express = require('express');
const bodyParser = require('body-parser');
const uuid = require('node-uuid');
const request = require('request');
const JSONbig = require('json-bigint');
const async = require('async');

//Not sure if I need to hard code these elements into the code or if these will "detect" what's needed?

const REST_PORT = (process.env.PORT || 5000);
const APIAI_ACCESS_TOKEN = process.env.APIAI_ACCESS_TOKEN;
const APIAI_LANG = process.env.APIAI_LANG || 'en';
const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;

const apiAiService = apiai(APIAI_ACCESS_TOKEN, {language: APIAI_LANG, requestSource: "fb"});
const sessionIds = new Map();

function processEvent(event) {
    var sender = event.sender.id.toString(); //this is the person who is using the chatbot

    if ((event.message && event.message.text) || (event.postback && event.postback.payload)) {
        var text = event.message ? event.message.text : event.postback.payload;
        // Handle a text message from this sender

        if (!sessionIds.has(sender)) {
            sessionIds.set(sender, uuid.v1());
        }

        console.log("Text", text);

        let apiaiRequest = apiAiService.textRequest(text,
            {
                sessionId: sessionIds.get(sender)
            });

        apiaiRequest.on('response', (response) => {
            if (isDefined(response.result)) {
                let responseText = response.result.fulfillment.speech; 
				//THIS is how it parses JSON returns from API.ai
                let responseData = response.result.fulfillment.data;
                let action = response.result.action;
				
				/*
				First Alteration of code.  Adding if action = find_event then alter the response text.
				*/
			var eventcity = response.result.contexts[0].parameters.geo-city;
            var eventzipcode = response.result.contexts[0].parameters.zip-code;
            var searchservice = response.result.contexts[0].parameters.event_service;
			var loc = "";
			var eventbritecarosel = "";
			
				if(action == "find_events"){
					if(eventcity && searchservice == "eventbrite"){
						loc = eventcity;
						eventbritecarosel = event_eventbrite(loc, sender);
						sendFBMessage(sender,eventbritecarosel);
						//responseText = responseText + " and the test worked!";
					}
					else if(eventzipcode && searchservice == "eventbrite"){
						loc = eventzipcode;
						eventbritecarosel = event_eventbrite(loc, sender);
						sendFBMessage(sender,eventbritecarosel);						
					} 
					else if(searchservice == "meetup"){              
						 event_meetup(eventcity,eventzipcode);
					}
				}
				else if (action == "the_greatness"){
				responseText = responseText + " this is the greatness";
				}
				else if (action == "black_people"){
				responseText = responseText + " logic for black people";
				}

                if (isDefined(responseData) && isDefined(responseData.facebook)) {
                    if (!Array.isArray(responseData.facebook)) {
                        try {
                            console.log('Response as formatted message');
                            sendFBMessage(sender, responseData.facebook);
                        } catch (err) {
                            sendFBMessage(sender, {text: err.message});
                        }
                    } else {
                        responseData.facebook.forEach((facebookMessage) => {
                            try {
                                if (facebookMessage.sender_action) {
                                    console.log('Response as sender action');
                                    sendFBSenderAction(sender, facebookMessage.sender_action);
                                }
                                else {
                                    console.log('Response as formatted message');
                                    sendFBMessage(sender, facebookMessage);
                                }
                            } catch (err) {
                                sendFBMessage(sender, {text: err.message});
                            }
                        });
                    }
                } else if (isDefined(responseText)) {
                    console.log('Response as text message');
                    // facebook API limit for text length is 320,
                    // so we must split message if needed
                    var splittedText = splitResponse(responseText);

                    async.eachSeries(splittedText, (textPart, callback) => {
                        sendFBMessage(sender, {text: textPart}, callback);
                    });
                }

            }
        });

        apiaiRequest.on('error', (error) => console.error(error));
        apiaiRequest.end();
    }
}

//You can't send responses in FB above 320 characters, so this splits it into chunks
function splitResponse(str) {
    if (str.length <= 320) {
        return [str];
    }

    return chunkString(str, 300);
}

//This helps the splitResponse method to break up messages into chunks of 320 characters or less
function chunkString(s, len) {
    var curr = len, prev = 0;

    var output = [];

    while (s[curr]) {
        if (s[curr++] == ' ') {
            output.push(s.substring(prev, curr));
            prev = curr;
            curr += len;
        }
        else {
            var currReverse = curr;
            do {
                if (s.substring(currReverse - 1, currReverse) == ' ') {
                    output.push(s.substring(prev, currReverse));
                    prev = currReverse;
                    curr = currReverse + len;
                    break;
                }
                currReverse--;
            } while (currReverse > prev);
        }
    }
    output.push(s.substr(prev));
    return output;
}

//This method actually sends the message to the facebook app
function sendFBMessage(sender, messageData, callback) {
    request({
        url: 'https://graph.facebook.com/v2.6/me/messages',
        qs: {access_token: FB_PAGE_ACCESS_TOKEN},
        method: 'POST',
        json: {
            recipient: {id: sender},
            message: messageData
        }
    }, (error, response, body) => {
        if (error) {
            console.log('Error sending message: ', error);
        } else if (response.body.error) {
            console.log('Error: ', response.body.error);
        }

        if (callback) {
            callback();
        }
    });
}

function sendFBSenderAction(sender, action, callback) {
    setTimeout(() => {
        request({
            url: 'https://graph.facebook.com/v2.6/me/messages',
            qs: {access_token: FB_PAGE_ACCESS_TOKEN},
            method: 'POST',
            json: {
                recipient: {id: sender},
                sender_action: action
            }
        }, (error, response, body) => {
            if (error) {
                console.log('Error sending action: ', error);
            } else if (response.body.error) {
                console.log('Error: ', response.body.error);
            }
            if (callback) {
                callback();
            }
        });
    }, 1000);
}

function doSubscribeRequest() {
    request({
            method: 'POST',
            uri: "https://graph.facebook.com/v2.6/me/subscribed_apps?access_token=" + FB_PAGE_ACCESS_TOKEN
        },
        (error, response, body) => {
            if (error) {
                console.error('Error while subscription: ', error);
            } else {
                console.log('Subscription result: ', response.body);
            }
        });
}

function isDefined(obj) {
    if (typeof obj == 'undefined') {
        return false;
    }

    if (!obj) {
        return false;
    }

    return obj !== null;
}

const app = express();

app.use(bodyParser.text({type: 'application/json'}));

app.get('/webhook/', (req, res) => {
    if (req.query['hub.verify_token'] == FB_VERIFY_TOKEN) {
        res.send(req.query['hub.challenge']);

        setTimeout(() => {
            doSubscribeRequest();
        }, 3000);
    } else {
        res.send('Error, wrong validation token');
    }
});

app.post('/webhook/', (req, res) => {
    try {
        var data = JSONbig.parse(req.body);

        if (data.entry) {
            let entries = data.entry;
            entries.forEach((entry) => {
                let messaging_events = entry.messaging;
                if (messaging_events) {
                    messaging_events.forEach((event) => {
                        if (event.message && !event.message.is_echo ||
                            event.postback && event.postback.payload) {
                            processEvent(event);
                        }
                    });
                }
            });
        }

        return res.status(200).json({
            status: "ok"
        });
    } catch (err) {
        return res.status(400).json({
            status: "error",
            error: err
        });
    }

});

app.listen(REST_PORT, () => {
    console.log('Rest service ready on port ' + REST_PORT);
});

doSubscribeRequest();

/*
*****************************************************
The below code represents functions/methods that have the goal of obtaining information from user
input, to log those requests, and to find out how the users behave.
*****************************************************
*/

/**
This method is to find events through the eventbrite API and returns them for user interaction
//https://www.eventbrite.com/developer/v3/endpoints/events/
**/
function event_eventbrite(locate, sender){

		request({
		  url: 'https://www.eventbriteapi.com/v3/events/search/?token=7JHPO6VFBV5CQKPPIN3G&q=weed,cannabis,marijuana&sort_by=distance&location.within=30mi&location.address='+locate,
          headers: {
				'Authorization' : 'Bearer 7JHPO6VFBV5CQKPPIN3G'
			},
			method: 'GET'
		},(error, response, body) => {
			 if (!error && response.statusCode == 200) {
				var ebrite = JSON.parse(body);
				console.log(ebrite.error_description + " - is the Eventbrite error");
			  }

				var eventbapi = JSON.parse(body);
				var eventbrite = eventbapi.events;
				var numofevents = eventbrite.length;
				//This code checks if events are available from eventbrite.  If num of events is zero, there's nothing to show
            
				if (numofevents <=0)    {
					//find some way to inform my NLP that the events are zero & write multiple responses for it
					//context.sendResponse("Eventbrite returned zero events in this area, unfortunately");
					//insert meetup function here to search meetup to find events since eventbrite doesn't have any
				}
				else if(numofevents >=10){
						numofevents = 10;
					}
			var elementsar = [];
			var messageData = [];
				for(var ie=0;ie<numofevents;ie++){
				
					var eimage = eventbrite[ie].logo.url;
					var etitle = eventbrite[ie].name.text;
					var edate = eventbrite[ie].start.local;
					var elink = eventbrite[ie].url;

						if(!eventbrite.logo.url){
							eventbrite.logo.url = "https://en.wikipedia.org/wiki/Smiley#/media/File:Smiley.svg";
							//CHANGE THIS TO myTHCGuide logo once we choose one!
						}
					elementsar.push({
							title: etitle,
							subtitle: edate,
							item_url: elink,               
							image_url: eimage,
							buttons: [{
							  type: "web_url",
							  url: elink,
							  title: "More Info"
							}]
							});
				}
				messageData = {
					recipient: {
					  id: sender
					},
					message: {
					  attachment: {
						type: "template",
						payload: {
						  template_type: "generic",
						  elements: elementsar
						}
					  }
					}
				  };
			return messageData;
		});	
	}	 