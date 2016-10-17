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

				if(action == "find_events"){	
					//inputs from API.ai for knowing which calls to make afterwards
					var eventcity = response.result.contexts[0].parameters["geo-city"];
					var eventzipcode = response.result.contexts[0].parameters["zip-code"];
					var searchservice = response.result.contexts[0].parameters.event_service;
					var loc = "";
					var eventbritecarosel = "";

					if(eventcity && searchservice == "eventbrite"){
						loc = eventcity;
						//eventbritecarosel = event_eventbrite(loc, sender);
						//sendFBMessage(sender,eventbritecarosel);
						responseText = responseText + " QXL city & event! ";
					}
					else if(eventzipcode && searchservice == "eventbrite"){
						loc = eventzipcode;
						eventbritecarosel = event_eventbrite(loc, sender);
						//sendFBMessage(sender,eventbritecarosel);
						console.log("here is the main function's output for the structured message " + event_eventbrite(loc,sender)); // undefined
						console.log("here is the same thing, but using the variable " + eventbritecarosel); // undefined
						responseText = responseText + " QXL zipcode & event " + eventbritecarosel;		
					} 
					else if(searchservice == "meetup"){              
						 //event_meetup(eventcity,eventzipcode);
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
function event_eventbrite(location, senduser){

				var elementsar = [];
				var messageData = [];
		request({
		  url: 'https://www.eventbriteapi.com/v3/events/search/?token=7JHPO6VFBV5CQKPPIN3G&q=weed,cannabis,marijuana&sort_by=distance&location.within=30mi&location.address='+location,
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
				}
				else if(numofevents >=10){
						numofevents = 10;
					}
					

					for(var ie=0;ie<numofevents;ie++){
					
						var eimage = bb1.events[ie].logo.url;
						var etitle = bb1.events[ie].name.text;
						var edate = bb1.events[ie].start.local;
						var elink = bb1.events[ie].url;

							if(!bb1.events[ie].logo.url){
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
					  };	console.log("This is the message array but Right before the Return " + JSON.stringify(messageData));
					  sendFBMessage(sender,JSON.stringify(messageData));
					  
			 });	 
}

function event_eventbriteq(locate, senduser){

	var ebody = event_eventbrite_apicall(locate);
						console.log("this is inside the regular function " + ebody);
				//var eventbapi = JSON.parse(ebody);
				//var eventbrite = eventbapi.events;
				//var eventbrite = ebody.pagination;
				//var numofevents = eventbrite.length;
				//This code checks if events are available from eventbrite.  If num of events is zero, there's nothing to show
				
					if (eventbrite){
					return ("topvalue2");
					}
 	/*           
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
					/*	elementsar.push({
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
					  }; */

		
		//return (messageData);
		return (ebody);
	}	

/**
This method is to find cannabis strain information based on a user provided strain name.  The user has to know the name of a specific strain 
for this function to work
**/
function specific_strain(context,event){

// https://developers.cannabisreports.com/docs/strains-search-query

//grab the strain name from the user input, conduct a search, and present the options to the user to find out more about

var specific_strain_name = "og";  //don't assign this variable in the production version, doing it here just to test.  do NOT assign this variable!!
            context.simplehttp.makeGet("https://www.cannabisreports.com/api/v1.0/strains/search/" + specific_strain_name,null,function(context,event){
			
	        var strainnames = JSON.parse(event.getresp);
			var numofstrains = strainnames.data.length;
	        var name;

	        for(var i=0;i<strainnames.data.length;i++){
	            var obj = strainnames.data[i];
	            var sname = obj.name;
	            var simage = {"type":"image","originalUrl": obj.image ,"previewUrl": obj.image};
	        }
	        

	    });	  

}

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
function strain_per_condition(context,event){
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
This method is to find events through the meet up API and returns them for user interaction
**/
function event_meetup(context,event){
/*
// check if the variable we have gotten from API.AI is any good and has the zip code we need within it.  If it does, we can assign it to our location variable and make API call
// set variable "location" to be the zip code passed to us from API.ai for use with meetup api call - https://www.meetup.com/meetup_api/docs/2/open_events/ for API guidance

context.simplehttp.makeGet("https://api.meetup.com/2/open_events?key=7b196b2b6510335c99242643b2a53&sign=true&topic=cannabis,weed,marijuana&zip="+location+"&radius=20",null,function (context, event){
	        var meetu = JSON.parse(event.getresp);
	        var mname;
	        var numofeventsm = meetu.meta.total_count;
			
			if(numofeventsm <=0){
			context.sendResponse("Meetup returned zero events in this area, unfortunately");
			}
			else if(numofeventsm>=10){
					numofeventsm = 10;
					}
					for(var im=0;im<meetu.results.length;im++){
						var meetup = meetu.results[im];
						mname = meetup.name;
						var mdescpt = meetup.description;
						}
				}
	        
	    });

*/
}

/**
This method is to get the birthday of the user, to ensure that they are old enough to use the bot and for better
understnding our users
**/
function obtain_birthday(context,event){
}	