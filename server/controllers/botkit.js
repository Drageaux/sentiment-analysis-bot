//CONFIG===============================================

/* Uses the slack button feature to offer a real time bot to multiple teams */
var Botkit = require('botkit');
var mongoUri = process.env.MONGODB_URI || 'mongodb://localhost/sentiment-analysis';
var botkit_mongo_storage = require('../../config/botkit_mongo_storage')({mongoUri: mongoUri});
var unirest = require("unirest");

if (!process.env.SLACK_ID || !process.env.SLACK_SECRET || !process.env.PORT) {
    console.log('Error: Specify SLACK_ID SLACK_SECRET and PORT in environment');
    process.exit(1);
}

var controller = Botkit.slackbot({
    storage: botkit_mongo_storage
});

exports.controller = controller;

//CONNECTION FUNCTIONS=====================================================
exports.connect = function (team_config) {
    var bot = controller.spawn(team_config);
    controller.trigger('create_bot', [bot, team_config]);
};

// just a simple way to make sure we don't
// connect to the RTM twice for the same team
var _bots = {};

function trackBot(bot) {
    _bots[bot.config.token] = bot;
}

controller.on('create_bot', function (bot, team) {

    if (_bots[bot.config.token]) {
        // already online! do nothing.
        console.log("already online! do nothing.")
    }
    else {
        bot.startRTM(function (err) {

            if (!err) {
                trackBot(bot);

                console.log("RTM ok")

                controller.saveTeam(team, function (err, id) {
                    if (err) {
                        console.log("Error saving team")
                    }
                    else {
                        console.log("Team " + team.name + " saved")
                    }
                })
            }

            else {
                console.log("RTM failed")
            }

            bot.startPrivateConversation({user: team.createdBy}, function (err, convo) {
                if (err) {
                    console.log(err);
                } else {
                    convo.say('I am a bot that has just joined your team');
                    convo.say('You must now /invite me to a channel so that I can be of use!');
                }
            });

        });
    }
});

//REACTIONS TO EVENTS==========================================================

// Handle events related to the websocket connection to Slack
controller.on('rtm_open', function (bot) {
    console.log('** The RTM api just connected!');
});

controller.on('rtm_close', function (bot) {
    console.log('** The RTM api just closed');
    // you may want to attempt to re-open
});

//DIALOG ======================================================================

controller.hears('hello', 'direct_message', function (bot, message) {
    bot.reply(message, 'Hello!');
});

controller.hears('^stop', 'direct_message', function (bot, message) {
    // bot.reply(message, 'Goodbye');
    // bot.rtm.close();
});

    console.log(message);
    controller.storage.users.get(message.user, function (err, user) {

        if (!isNaN(user.sentiment)) {
            bot.reply(message, "Hey @" + user.user + ", your mood today has a value of " + user.sentiment);
        }
    });
});

controller.on("ambient", function (bot, message) {
    // TODO: run analysis here
    console.log(message);
    unirest.post("https://community-sentiment.p.mashape.com/text/")
        .header("X-Mashape-Key", "hWOV4zrmvnmshrKspMpzeyFmPt48p1xMWR5jsnpqG5887Iyj4v")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .send("txt=" + message.text)
        .end(function (result) {
            console.log(result.status, message.text, result.body);
            controller.storage.users.get(message.user, function (err, user) {
                if (user) {
                    if (isNaN(user.sentiment)) {
                        user.sentiment = 0;
                    }

                    var confidence = parseInt(result.body.result.confidence);
                    var sentiment = result.body.result.sentiment;
                    var sentimentValue = confidence * message.text.split(" ").length;

                    if (!isNaN(sentimentValue)) {
                        if (sentiment == "Positive") {
                            user.sentiment += sentimentValue;
                        } else if (sentiment == "Negative") {
                            user.sentiment -= sentimentValue;
                        }
                        controller.storage.users.save(user, function (err, user) {
                            if (err) {
                                console.log(err)
                            }
                        });
                    }
                }
            });
        });
    // bot.api.reactions.add({
    //     timestamp: message.ts,
    //     channel: message.channel,
    //     name: 'robot_face'
    // }, function (err) {
    //     if (err) {
    //         console.log(err)
    //     }
    //     bot.reply(message, 'I heard you loud and clear boss.');
    // });
});

controller.storage.teams.all(function (err, teams) {

    console.log(teams)

    if (err) {
        throw new Error(err);
    }

    // connect all teams with bots up to slack!
    for (var t  in teams) {
        if (teams[t].bot) {
            var bot = controller.spawn(teams[t]).startRTM(function (err) {
                if (err) {
                    console.log('Error connecting bot to Slack:', err);
                } else {
                    trackBot(bot);
                }
            });
        }
    }

});
