'use strict';

const config = require('./config');
const bunyan = require('bunyan');
const Circuit = require('circuit-sdk');
const mqtt = require('mqtt');

let sdkLogger = bunyan.createLogger({
    name: 'sdk',
    stream: process.stdout,
    level: config.sdkLogLevel
});

let logger = bunyan.createLogger({
    name: 'mqtt',
    stream: process.stdout
});

let user;
let monitoringConv;
let mqttClient;

logger.info('[MQTT]: Instantiate Circuit client');

Circuit.setLogger(sdkLogger);

let Bot = function(client) {

    /*
     * processItemAddedEvent
     */
    function processItemAddedEvent(evt) {
        if (evt.item.text && evt.item.creatorId !== user.userId) {
            logger.info(`[MQTT] Received itemAdded event with itemId [${evt.item.itemId}] and content [${evt.item.text.content}]`);
            // processCommand(evt.item.convId, evt.item.parentItemId || evt.item.itemId, evt.item.text.content);
        }
    }

    /*
     * processItemUpdatedEvent
     */
    function processItemUpdatedEvent(evt) {
        if (evt.item.text && evt.item.creatorId !== user.userId) {
            if (evt.item.text.content) {
                let lastPart = evt.item.text.content.split('<hr>').pop();
                logger.info(`[MQTT] Received itemUpdated event with: ${lastPart}`);
                // processCommand(evt.item.convId, evt.item.parentItemId || evt.item.itemId, lastPart);
            }
        }
    }

    async function sendControlForm(convId, currentIntensity, currentColor) {
        await client.addTextItem(convId, {
            content: 'Control Form',
            form: {
                id: 'controlForm',
                controls: [{
                    type: Circuit.Enums.FormControlType.LABEL,
                    text: 'Intensity'
                    },{
                    type: Circuit.Enums.FormControlType.DROPDOWN,
                    name: 'intensity',
                    defaultValue: currentIntensity || '0',
                    options: [{
                        text: 'Off',
                        value: '0'
                    },{
                        text: '25%',
                        value: '25'
                    },{
                        text: '50%',
                        value: '50'
                    },{
                        text: '75%',
                        value: '75'
                    },{
                        text: '100%',
                        value: '100'
                    }]
                },{
                    type: Circuit.Enums.FormControlType.LABEL,
                    text: 'Color'
                },{
                    type: Circuit.Enums.FormControlType.DROPDOWN,
                    name: 'color',
                    defaultValue: currentColor || 'red',
                    options: [{
                        text: 'RED',
                        value: 'red'
                    },{
                        text: 'GREEN',
                        value: 'green'
                    },{
                        text: 'BLUE',
                        value: 'blue'
                    }]
                }, {
                    type: Circuit.Enums.FormControlType.BUTTON,
                    options: [{
                        text: 'Submit',
                        notification: 'Submitted',
                        action: 'submit'
                    }]
                }]
            }
        });
    }

    /*
     * processFormSubmission
     */
    function processFormSubmission(evt) {
        let currentIntensity;
        let currentColor;
        logger.info(`[MQTT] process form submission. ${evt.form.id}`);
        logger.info(`[MQTT] Form Data: ${JSON.stringify(evt.form.data)}`);
        evt.form.data.forEach(ctrl => {
            logger.debug(`[MQTT] ${ctrl.key}: ${ctrl.value}`);
            switch (ctrl.name) {
                case 'intensity':
                    currentIntensity = ctrl.value;
                    break;
                case 'color':
                    currentColor = ctrl.value;
                    break;
                default:
                    logger.error(`Unknown key in submitted form: ${ctrl.key}`);
                    break;
            }
        });
        logger.info(`[MQTT] Intensity set to ${currentIntensity} and color set to ${currentColor}`);
        // TODO: Send MQTT command

        // Update form
        client.updateTextItem({
            itemId: evt.itemId,
            content: 'Control Form',
            form: {
                id: 'controlForm',
                controls: [{
                    type: Circuit.Enums.FormControlType.LABEL,
                    text: 'Intensity'
                    },{
                    type: Circuit.Enums.FormControlType.DROPDOWN,
                    name: 'intensity',
                    defaultValue: currentIntensity || '0',
                    options: [{
                        text: 'Off',
                        value: '0'
                    },{
                        text: '25%',
                        value: '25'
                    },{
                        text: '50%',
                        value: '50'
                    },{
                        text: '75%',
                        value: '75'
                    },{
                        text: '100%',
                        value: '100'
                    }]
                },{
                    type: Circuit.Enums.FormControlType.LABEL,
                    text: 'Color'
                },{
                    type: Circuit.Enums.FormControlType.DROPDOWN,
                    name: 'color',
                    defaultValue: currentColor || 'red',
                    options: [{
                        text: 'RED',
                        value: 'red'
                    },{
                        text: 'GREEN',
                        value: 'green'
                    },{
                        text: 'BLUE',
                        value: 'blue'
                    }]
                }, {
                    type: Circuit.Enums.FormControlType.BUTTON,
                    options: [{
                        text: 'Submit',
                        notification: 'Submitted',
                        action: 'submit'
                    }]
                }]
            }
        })
    }

    /*
     * addEventListeners
     */
    function addEventListeners(client) {
        logger.info('[MQTT] addEventListeners');
        client.addEventListener('itemAdded', processItemAddedEvent);
        client.addEventListener('itemUpdated', processItemUpdatedEvent);
        client.addEventListener('formSubmission', processFormSubmission);
    }

    /*
     * buildConversationItem
     */
    function buildConversationItem(parentId, subject, content, attachments) {
        return {
            parentId: parentId,
            subject: subject,
            content: content,
            contentType: Circuit.Constants.TextItemContentType.RICH,
            attachments: attachments && [attachments],
        };
    }

    /*
     * getMonitoringConversation
     */
    async function getMonitoringConversation() {
        if (config.convId) {
            logger.info(`[MQTT] Check if conversation ${config.convId} exists`);
            try {
                let conv = await client.getConversationById(config.convId);
                if (conv) {
                    logger.info(`[MQTT] conversation ${config.convId} exists`);
                    return conv;
                }
            } catch (error) {
                logger.error(`[MQTT] Unable to get configured conversation. Error: ${error}`);
            }
        }
        logger.info('[MQTT] Conversation not configured or it does not exist. Find direct conv with owner');
        return client.getDirectConversationWithUser(config.botOwnerEmail, true);
    }

    /*
     * Connect to MQTT broker
     */
    this.connectToMqttBroker = function() {
        return new Promise((resolve, reject) => {
            if (!config.mqttBroker) {
                resolve();
                return;
            }
            mqttClient = mqtt.connect([config.mqttBroker]);
            mqttClient.on('connect', resolve);
            mqttClient.on('error', reject);
            mqttClient.on('message', (message) => {
                logger.info(`[MQTT] Received message "${message}`);
            });
        });
    }

    /*
     * terminate
     */
    this.terminate = function(err) {
        let error = new Error(err);
        logger.error(`[MQTT] bot failed ${error.message}`);
        logger.error(error.stack);
        process.exit(1);
    };

    /*
     * Logon Client
     */
    this.logonBot = function() {
        return new Promise((resolve) => {
            let retry;
            addEventListeners(client);
            let logon = async function() {
                try {
                    user = await client.logon();
                    clearInterval(retry);
                    resolve();
                } catch (error) {
                    logger.error(`[MQTT] Error logging Bot. Error: ${error}`);
                }
            };
            logger.info(`[MQTT] Create bot instance with id: ${config.bot.client_id}`);
            retry = setInterval(logon, 2000);
        });
    };

    /*
     * say Hi
     */
    this.sayHi = async function() {
        logger.info('[MQTT] say hi');
        monitoringConv = await getMonitoringConversation();
        if (monitoringConv) {
            client.addTextItem(monitoringConv.convId, buildConversationItem(null, `Hi from ${user.displayName}`,
            `I am ready. Use "@${user.displayName} help , or ${user.displayName} help, or just //help" to see available commands`));

            sendControlForm(monitoringConv.convId, false);
        }
    };


    /*
     * Update user display name if needed
     */
    this.updateUserData = async function() {
        if (user && user.displayName !== `${config.bot.first_name} ${config.bot.last_name}`) {
            // Need to update user data
            try {
                user.firstName = config.bot.first_name;
                user.lastName = config.bot.last_name;
                user.displayName = `${config.bot.first_name} ${config.bot.last_name}`;
                await client.updateUser({
                    userId: user.userId,
                    firstName: config.bot.first_name,
                    lastName: config.bot.last_name,
                });
            } catch (error) {
                logger.error(`[MQTT] Unable to update user data. Error: ${error}`);
            }
        }
        return user;
    };
};

let bot = new Bot(new Circuit.Client(config.bot));
bot.connectToMqttBroker()
    .then(bot.logonBot)
    .then(bot.updateUserData)
    .then(bot.sayHi)
    .catch(bot.terminate);

