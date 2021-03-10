'use strict';

const MQTT = require('async-mqtt');
const NefitEasyClient = require('nefit-easy-commands');
const Promise = require("bluebird");

const DELAY = process.env.POLL_DELAY || 300000;
const PUBLISH_TO_SEPERATE_TOPICS = process.env.PUBLISH_TO_SEPERATE_TOPICS !== undefined ? process.env.PUBLISH_TO_SEPERATE_TOPICS : false;
function checkOption(option, error){
    if(!option){
        console.error(error);
        process.exit(1);
    }
}

let params = {
    serialNumber   : process.env.NEFIT_SERIAL_NUMBER,
    accessKey      : process.env.NEFIT_ACCESS_KEY,
    password       : process.env.NEFIT_PASSWORD,
    mqttUrl        : process.env.MQTT_URL,
    mqttUsername   : process.env.MQTT_USERNAME,
    mqttPassword   : process.env.MQTT_PASSWORD,
};

const TOPIC_PREFIX = (process.env.TOPIC_PREFIX || "/nefit/".concat(params.serialNumber)).replace(/\/+$/, '');

checkOption(params.serialNumber, "NEFIT_SERIAL_NUMBER not set");
checkOption(params.accessKey,    "NEFIT_ACCESS_KEY not set");
checkOption(params.password,     "NEFIT_PASSWORD not set");
checkOption(params.mqttUrl,      "MQTT_URL not set.");

const mqttClient = MQTT.connect(params.mqttUrl,
                     {"username": params.mqttUsername,
                      "password": params.mqttPassword})

const mqttClientP = new Promise(function(resolve,reject){
    mqttClient.on('connect', () => resolve(mqttClient));
    mqttClient.on('error', (error) => { reject(error); });
});

const nefitClient  = NefitEasyClient({
    serialNumber   : params.serialNumber,
    accessKey      : params.accessKey,
    password       : params.password
});


function normalizeStatus(status) {
    let normalized = {};

    for(let key in status) {
        let value = status[key];

        if (typeof value === 'boolean') {
            value = value ? '1' : '0'
        }

        if (value === null) {
            continue;
        }

        key = key.replace(/\W+/g, '_')
        normalized[key] = value;
    }

    return normalized;
}

function publishStatus(nefitClient, mqtt, publishOnce = false){
    let promises = [nefitClient.status(),
                    nefitClient.pressure(),
                    nefitClient.supplyTemperature(),
                    ];
    return Promise.all(promises)
        .spread(async (status, pressure, supplyTemperature) => {
            status = normalizeStatus(status);
            if (PUBLISH_TO_SEPERATE_TOPICS) {
                for(let key in status) {
                    let value = status[key];
                    await mqtt.publish(TOPIC_PREFIX+'/'+key, value.toString());
                }
                await mqtt.publish(TOPIC_PREFIX+'/serial', params.serialNumber.toString());
                await mqtt.publish(TOPIC_PREFIX+'/pressure', pressure.pressure.toString());
                await mqtt.publish(TOPIC_PREFIX+'/supply_temperature', supplyTemperature.temperature.toString());
            } else {
                message = status;
                message['serial'] = params.serialNumber;
                message['pressure'] = pressure.pressure;
                message['suppley_temperature'] = supplyTemperature.temperature;
                let message = {
                    'mode' : status['user mode'],
                    'setpoint': status['temp setpoint'],
                    'inhouse':  status['in house temp'],
                    'outdoorTemp': status['outdoor temp'],
                    'overrideSetpoint': status['temp override temp setpoint'],
                    'manualSetpoint': status['temp manual setpoint'],
                    'hotWaterActive': status['hot water active']? 1 :0,
                    'serial' : params.serialNumber,
                    'pressure': pressure.pressure,
                    'supplyTemperature': supplyTemperature.temperature
                };
                await mqtt.publish(topic, JSON.stringify(message));
            }
        })
        .delay(DELAY, new Promise((resolve,reject) => !publishOnce ? resolve() : null)).then(() => {
            console.log('delayed')
            return publishStatus(nefitClient, mqtt)
        });
}
async function handleMessage(nefitClient, mqtt, topic, message){
    if(topic.endsWith("settemperature")){
        return await nefitClient.setTemperature(message.toString())
            .then(() => {
                console.log('set Temparature to ' + message);
                publishStatus(nefitClient, mqtt, true)
            })
    }
    if(topic.endsWith("setmode") && (message == "manual" || message == "clock")) {
        return await nefitClient.setUserMode(message.toString())
            .then(() => {
                console.log('setUserMode to ' + message);
                publishStatus(nefitClient, mqtt, true)
            })
    }
    if(topic.endsWith("sethotwatersupply") && (message == "on" || message == "off")) {
        return await nefitClient.setHotWaterSupply(message.toString())
            .then(() => {
                console.log('set Hot water supply to ' + message);
                publishStatus(nefitClient, mqtt, true)
            })
    }
    console.log("unsupported message on topic " + topic +": "+message)
}

Promise.using(nefitClient.connect(), mqttClientP, 
    async (_, mqttClient) => {
        console.log("Connected...");
        await mqttClient.subscribe(TOPIC_PREFIX.concat("/command/+"))
        mqttClient.on('message', function(topic, message){
            handleMessage(nefitClient, mqttClient, topic, message);
        });
        return publishStatus(nefitClient, mqttClient);
    })
    .catch((e) => {
        console.error('error', e)
    }).finally(async () => {
        nefitClient.end();
        await mqttClient.end();        
    });
