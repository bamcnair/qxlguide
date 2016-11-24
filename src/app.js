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

const DATABASE_URL = 'postgres://oakumnucezzlzg:HUWRoevSG6AWhpuVSkqGh5HkzO@ec2-54-235-208-3.compute-1.amazonaws.com:5432/d4ctqr7gbk3nul'

//  This code is meant to connect the app to our postgresql database when the app initializes

var pg = require('pg');

pg.defaults.ssl = true;
pg.connect(process.env.DATABASE_URL, function(err, client) {
  if (err) throw err;
  console.log('Connected to postgres! Getting schemas...');

  client
    .query('SELECT table_schema,table_name FROM information_schema.tables;')
    .on('row', function(row) {
      console.log(JSON.stringify(row));
    });
});

//Code example captured from https://devcenter.heroku.com/articles/heroku-postgresql#connecting-in-node-js

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
                //let responseData = response.result.fulfillment.data;	
				let payloadData = response.result.fulfillment.messages;
                let action = response.result.action;
				var responseData = "";
				
				if ((payloadData && payloadData[0].payload)){
				console.log("Payload variable is defined");
				responseData = response.result.fulfillment.messages[0].payload;
				}
				else {
				console.log("this is definitely going to be an empty payload.  No value here");				
				 //   let responseData = response.result.fulfillment.messages[0].payload;	
				//This insertion for responseData is to get cards, quick replies, images, and others from API.ai for use in FB, Kik, Telegram, Slack via Custom Payloads 11-04-16
				}

				
				/*
				First Alteration of code.  Adding if action = find_event then alter the response text.
				*/

				if(action == "find_events"){	
					//inputs from API.ai for knowing which calls to make afterwards
					var eventcity = response.result.contexts[0].parameters["geo-city"];
					var eventzipcode = response.result.contexts[0].parameters["zip-code"];
					var searchservice = response.result.contexts[0].parameters.event_service;
					var loc = "";
					var eventbritecarosel = "";

					if(eventcity && searchservice == "eventbrite"){
						loc = eventcity;
						event_eventbrite(loc, sender);
					}
					else if(eventzipcode && searchservice == "eventbrite"){
						loc = eventzipcode;
						event_eventbrite(loc, sender);
					} 
					else if(searchservice == "meetup"){              
						 event_meetup(eventcity, eventzipcode, sender);
					}
				}
				else if (action == "strain_menu"){
				strain_menu(sender);
				}
				else if (action == "specific_strain"){
				var strain_name = response.result.parameters.specific_strain;
				specific_strain(strain_name,sender);
				}	


				/* ******************************
				END OF FIRST ALTERATIOON of Code
				****************************** */
				
                if (isDefined(responseData) && isDefined(responseData.facebook)) {
                    if (!Array.isArray(responseData.facebook)) {
                        try {
                            console.log('Response as formatted message');
                            sendFBMessage(sender, responseData.facebook);
                        } catch (err) {
                            sendFBMessage(sender, {text: err.message});
                        }
                    } else {
                        async.eachSeries(responseData.facebook, (facebookMessage, callback) => {
                            try {
                                if (facebookMessage.sender_action) {
                                    console.log('Response as sender action');
                                    sendFBSenderAction(sender, facebookMessage.sender_action, callback);
                                }
                                else {
                                    console.log('Response as formatted message');
                                    sendFBMessage(sender, facebookMessage, callback);
                                }
                            } catch (err) {
                                sendFBMessage(sender, {text: err.message}, callback);
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
            } while (currReverse > prev)
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

function callSendAPIstructured(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: {access_token: FB_PAGE_ACCESS_TOKEN},
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      if (messageId) {
        console.log("Successfully sent message with id %s to recipient %s", 
          messageId, recipientId);
      } else {
      console.log("Successfully called Send API for recipient %s", 
        recipientId);
      }
    } else {
      console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
    }
  });  
}


function strain_menu(recipientId) {

 var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: "How Would You Like to Search?",
            subtitle: "Search for cannabis strains by keyword or medical need",              
            image_url: "https://pixabay.com/static/uploads/photo/2012/04/14/14/45/marijuana-34178_960_720.png",  //replace with the company logo when its time.
            buttons: [{
              type: "postback",
              title: "By Keyword",
              payload: "how do i search by keyword"
            }, {
              type: "postback",
              title: "By Medical Need",
              payload: "What helps me with medical conditions"
            }],
          }]
        }
      }
    }
  };  

  callSendAPIstructured(messageData);
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

/**
Function Notes

Find a way to add a "MORE" button to see more events if a person wants to see more than just 10, or see the next 10
**/
function event_eventbrite(location, senduser){

				var elementsar = [];
				var messageData = [];
		request({
		  url: 'https://www.eventbriteapi.com/v3/events/search/?token=7JHPO6VFBV5CQKPPIN3G&q=cannabis&sort_by=distance&location.within=30mi&location.address='+location,  
		  //took out topic=cannabis,weed,marijuana so that query doesn't have to match all three.  Cannabis is popular so i kept it in.
          headers: {
				'Authorization' : 'Bearer 7JHPO6VFBV5CQKPPIN3G'
			},
			method: 'GET'
		},(error, response, body) => {
			 if (!error && response.status_code == 200 || response.status_code == 400) {
				var ebrite = JSON.parse(body);
				console.log(ebrite.error_description + " - is the Eventbrite error");
			  }
			  else{
				var eventbapi = body;
				var bb1 = JSON.parse(eventbapi); 
				var numofevents = bb1.events.length;
					
				if (numofevents <=0)    {
					//find some way to inform my NLP that the events are zero & write multiple responses for it
					//context.sendResponse("Eventbrite returned zero events in this area, unfortunately");
					//insert meetup function here to search meetup to find events since eventbrite doesn't have any
					/*
					messageData = "There are no Eventbrite Events.  I'll search Meetup!";
					sendFBMessage(senduser, messageData);
					event_eventbrite(location, senduser);
					return;
					*/
					}
				else if(numofevents >=10){
						numofevents = 10;
					}
					

					for(var ie=0;ie<numofevents;ie++){
					
						var eimage = bb1.events[ie].logo.url;
						var etitle = bb1.events[ie].name.text;
						var edate = bb1.events[ie].start.local;
						var elink = bb1.events[ie].url;

							if(!eimage){
								bb1.events[ie].logo.url = "https://pixabay.com/static/uploads/photo/2012/04/14/14/45/marijuana-34178_960_720.png";
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
					}
					messageData = {
						recipient: {
						  id: senduser
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
					  callSendAPIstructured(messageData);
			 });	 
}

/**
This method is to find events through the meet up API and returns them for user interaction
**/
function event_meetup(mcity, mzipcode, senduser){

// check if the variable we have gotten from API.AI is any good and has the zip code we need within it.  If it does, we can assign it to our location variable and make API call
// set variable "location" to be the zip code passed to us from API.ai for use with meetup api call - https://www.meetup.com/meetup_api/docs/2/open_events/ for API guidance

				var elementsarm = [];
				var messageDatam = [];

		request({
		  url: 'https://api.meetup.com/2/open_events?key=7b196b2b6510335c99242643b2a53&sign=true&topic=cannabis&zip='+mzipcode+'&radius=30&city='+mcity,  //took out topic=cannabis,weed,marijuana so that query doesn't have to match all three.  Cannabis is popular so i kept it in.
			method: 'GET'
		},(error, response, body) => {
			 if (!error && (response.code == "bad_request" || response.code == "invalid_param")) {
			 //be sure to validate if this error arrangement is going to work for meetup
				var emeet = JSON.parse(body); 
			  }		
			  else{
				var meetuapi = body;
				var me1 = JSON.parse(meetuapi); 
				var numofeventsm = me1.meta.total_count;
					
				if (numofeventsm <=0)    {
					//find some way to inform my NLP that the events are zero & write multiple responses for it
					// make call to sendFBmessage that there are no events from this service, we will search the other one, then call eventbrite service
					//context.sendResponse("Meet Up returned zero events in this area, unfortunately");
					//insert eventbrite function here to search eventbrite to find events since meetup doesn't have any, and make it stop if the 
					//other service doesnt have any events either.
					/*
					messageDatam = "There are no Meetup Events.  I'll search eventbrite!";
					sendFBMessage(senduser, messageDatam);
					if(mcity){
					event_eventbrite(mcity, senduser);
					return;
					}
					else{
					event_eventbrite(mzipcode, senduser);
					return;
					}
					*/
				}
				else if(numofeventsm >=10){
						numofeventsm = 10;
					}		
					for(var im=0;im<numofeventsm;im++){
					/*
						if(!me1.results[im].group.photos.photo_link){
						me1.results[im].group.photos.photo_link = "https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/JfTabon%2C_San_Isidro%2C_Nueva_Ecijalands0088fvf_04.JPG/640px-JfTabon%2C_San_Isidro%2C_Nueva_Ecijalands0088fvf_04.JPG";
						//CHANGE THIS TO myTHCGuide logo once we choose one!
					}
					
						var mimage = me1.results[im].group.photos.photo_link;  */
						var mtitle = me1.results[im].name;
						//var mdate = me1.results[im].start.local;
						var mlink = me1.results[im].event_url;

					
						elementsarm.push({
								title: mtitle,
								//subtitle: mdate,
								item_url: mlink,               
								image_url: 'https://pixabay.com/static/uploads/photo/2012/04/14/14/45/marijuana-34178_960_720.png', //mimage,
								buttons: [{
								  type: "web_url",
								  url: mlink,
								  title: "More Info"
								}]
								});
					}
					}
					messageDatam = {
						recipient: {
						  id: senduser
						},
						message: {
						  attachment: {
							type: "template",
							payload: {
							  template_type: "generic",
							  elements: elementsarm
							}
						  }
						}
					  };
					  callSendAPIstructured(messageDatam);
			 });	 
}


/**
This method is to find cannabis strain information based on a user provided strain name.  The user has to know the name of a specific strain 
for this function to work
**/
function specific_strain(cr_strain,cr_senduser){

// https://developers.cannabisreports.com/docs/strains-search-query

//grab the strain name from the user input, conduct a search, and present the options to the user to find out more about

				var elementscr = []; 
				var messageDatacr = []; 
				
		request({
		  url: 'https://www.cannabisreports.com/api/v1.0/strains/search/'+cr_strain,   //change back from specific strain
            headers: {
				'X-API-Key' : 'c60873cc9da223d1d3a6c59ff19a72ba381e34d2'
			},
			method: 'GET'
		},(error, response, body) => {
			 if (!error && response.status_code == 200 || response.status_code == 400) {
				var cr_err = JSON.parse(body);
				console.log(cr_err.message + " - is the Cannabis Reports error");
			  }
			  else{
				var cr_respond = JSON.parse(body); 
				var cr1 = cr_respond.data;
				var numofstrains = cr_respond.meta.pagination.total;

				
				if (numofstrains <=0)  {
					//find some way to inform my NLP that the strains are zero & write multiple responses for it
					//context.sendResponse("Eventbrite returned zero strains in this area, unfortunately");
					/*
					messageData = "There are no Eventbrite Events.  I'll search Meetup!";
					sendFBMessage(senduser, messageData);
					event_eventbrite(location, senduser);
					return;
					*/
                   // sendFBMessage(sender, {text: 'Unfortunately we did not find any strains'});					
					//return;
					console.log("We didn't find any strains for that name " + numofstrains);
					return;
					}
				else if(numofstrains == 1){
				
				}
				else if(numofstrains >=10){
				//Sets a large number of strains to 10 as to not return an annoying amount of results and stuff.  You know?  Of course you do.
				//Also formats results as a carousel so users can easily find more information.  
						numofstrains = 10;
				}

					for(var is=0;is<numofstrains - 1;is++){
						var simage = cr1[is].image; 
						var sname = cr1[is].name;
						var slink = cr1[is].url;
						
					if (simage == 'https://www.cannabisreports.com/images/strains/no_image.png'){
						simage = 'https://pixabay.com/static/uploads/photo/2012/04/14/14/45/marijuana-34178_960_720.png';
						//Replace with the company logo when we are prepared
						}

						elementscr.push({
								title: sname,
								subtitle: "My THC Guide - Your Friendly Guide for Cannabis Knowledge",
								item_url: slink,               
								image_url: simage,
								buttons: [{
								  type: "web_url",
								  url: slink,
								  title: "More Info"
								  }]
						});
					}
					messageDatacr = {
						recipient: {
						  id: cr_senduser
						},
						message: {
						  attachment: {
							type: "template",
							payload: {
							  template_type: "generic",
							  elements: elementscr
							}
						  }
						}
					  };
					  callSendAPIstructured(messageDatacr);
					}					 
			 });								
}

/***
Make a function, or set of functions in cooperation with API.AI to make a weed strain reccomender.  So we ask them about experiences like "How do you want to feel?" and we give them 3 options with a quick reply.
then after that, we ask them about what kind of high they want to feel, like a body high, head high, or both.  Then ask them what kind of sensation do they want.  like a euphoria, a giddyness, sleepiness, energy
etc.  And then we get them a set of kinds of weed that produces that result.  We then give them a way to buy it after they make their selection.  Then we tell them who has it, and allow them to reserve it.  If they reserve,
their information goes to the dispensary, in a concealed email address, 

***/

/**
This method is to find a condition that a particular cannabis strain can help treat medically.  The user provides the condition, and we 
get a strain that could help with that condition.  For example, pain, cancer, PTSD, anxiety, or other conditions
**/
function condition_per_strain(context,event){
}

/**
This provides the medical conditions that a strain can help alleviate.  So the user provides a strain name, and we get the conditions
that the strain could assist with.  Its the opposite of the condition_per_strain 
**/
function medical_strains(context,event){
}

/**
This method is meant to get the user's email address from the messsaging platform that they are using to chat with us.
**/
function detect_user_email(context,event){
}

/**
This method is meant to subscribe the user's email to our email subscriber management service once the user gives us
permission
**/
function subscribe_user_email(context,event){
}

/**
This method is to display a survey to the user such that we can gather information from them for sponsors, customers, and for
other user purposes to better understand our users.
**/
function conduct_survey(context,event){
}


/**
This method is to get the birthday of the user, to ensure that they are old enough to use the bot and for better
understnding our users
**/
function obtain_birthday(context,event){
}	