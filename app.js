'use strict';

const MQTT = require('async-mqtt');
const NefitEasyClient = require('nefit-easy-commands');
const Promise = require("bluebird");
const nodeCleanup = require('node-cleanup');

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
const AUTODISCOVER_PREFIX = (process.env.AUTODISCOVER_PREFIX || "homeassistant").replace(/\/+$/, '');
const AUTODISCOVER_NAME = (process.env.AUTODISCOVER_NAME || "livingroom");

checkOption(params.serialNumber, "NEFIT_SERIAL_NUMBER not set");
checkOption(params.accessKey,    "NEFIT_ACCESS_KEY not set");
checkOption(params.password,     "NEFIT_PASSWORD not set");
checkOption(params.mqttUrl,      "MQTT_URL not set.");

const AUTODISCOVER_DEVICE = {
    identifiers: ["nefit_".concat(params.serialNumber.toString())],
    manufacturer: "Nefit Bosch",
    model: "Easy Connect mqtt",
    name: AUTODISCOVER_NAME
};

const mqttClient = MQTT.connect(params.mqttUrl,
                     {"username": params.mqttUsername,
                      "password": params.mqttPassword});

nodeCleanup(function (exitCode, signal) {
    if (signal) {
        mqttClient.publish(TOPIC_PREFIX+"/available", 'offline')
            .then(() => process.kill(process.pid, signal))
        nodeCleanup.uninstall(); // don't call cleanup handler again
        return false;
    }
});

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

        if (value === null || value === undefined || typeof value === 'object') {
            continue;
        }

        key = key.replace(/\W+/g, '_')
        normalized[key] = value;
    }

    return normalized;
}

function publishAutoDiscover(mqttClient, component, name, config) {
    mqttClient.publish(
        `${AUTODISCOVER_PREFIX}/${component}/${name}/config`,
        JSON.stringify(config),
        {qos: 1, retain: true}
    );
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
                    if (value !== undefined) {
                        value = value.toString()
                    }
                    await mqtt.publish(TOPIC_PREFIX+'/'+key, value);
                }

                await mqtt.publish(TOPIC_PREFIX+'/serial', params.serialNumber.toString());
                await mqtt.publish(TOPIC_PREFIX+'/pressure', pressure.pressure.toString());
                await mqtt.publish(TOPIC_PREFIX+'/supply_temperature', supplyTemperature.temperature.toString());
            } else {
               let  message = status;
                message['serial'] = params.serialNumber;
                message['pressure'] = pressure.pressure;
                message['supply_temperature'] = supplyTemperature.temperature;
                await mqtt.publish(TOPIC_PREFIX, JSON.stringify(message));
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

        await mqttClient.publish(TOPIC_PREFIX+"/command/setmode", 'manual')
            .then(() =>  console.log("Set mode to manual, because mqtt controls unit"))
            .catch(() =>  console.error("Failed to set mode to manual"));

        publishAutoDiscover(mqttClient, 'climate', "nefit_"+params.serialNumber.toString(), {
            device: AUTODISCOVER_DEVICE,
            min_temp: 5,
            max_temp: 30,
            modes: ['off', 'heat'],
            avty_t: TOPIC_PREFIX+"/available",
            mode_state_topic: TOPIC_PREFIX+"/mode",
            mode_command_topic: TOPIC_PREFIX+"/mode",
            current_temperature_topic: TOPIC_PREFIX+"/in_house_temp",
            temperature_command_topic: TOPIC_PREFIX+"/command/settemperature",
            temp_step: 0.5,
            temperature_state_topic: TOPIC_PREFIX+"/temp_setpoint",
            temperature_unit: 'C',
            precision: 0.1,
            unique_id: "nefit_"+params.serialNumber.toString()+"_thermostat",
            name: AUTODISCOVER_NAME,
        });

        publishAutoDiscover(mqttClient, 'sensor', "nefit_"+params.serialNumber.toString()+"_outdoor_temp", {
            avty_t: TOPIC_PREFIX+"/available",
            device: AUTODISCOVER_DEVICE,
            device_class: 'temperature',
            unique_id: "nefit_"+params.serialNumber.toString()+"_outdoor_temp",
            name: AUTODISCOVER_NAME+"_outdoor_temp",
            state_topic: TOPIC_PREFIX+"/outdoor_temp",
            unit_of_measurement: '°C',
        });

        publishAutoDiscover(mqttClient, 'sensor', "nefit_"+params.serialNumber.toString()+"_supply_temperature", {
            avty_t: TOPIC_PREFIX+"/available",
            device: AUTODISCOVER_DEVICE,
            device_class: 'temperature',
            unique_id: "nefit_"+params.serialNumber.toString()+"_supply_temp",
            name: AUTODISCOVER_NAME+"_supply_temp",
            state_topic: TOPIC_PREFIX+"/supply_temperature",
            unit_of_measurement: '°C',
        });
        publishAutoDiscover(mqttClient, 'sensor', "nefit_"+params.serialNumber.toString()+"_temp_manual_setpoint", {
            avty_t: TOPIC_PREFIX+"/available",
            device: AUTODISCOVER_DEVICE,
            device_class: 'temperature',
            unique_id: "nefit_"+params.serialNumber.toString()+"_temp_manual_setpoint",
            name: AUTODISCOVER_NAME+"_temp_manual_setpoint",
            state_topic: TOPIC_PREFIX+"/temp_manual_setpoint",
            unit_of_measurement: '°C',
        });
        publishAutoDiscover(mqttClient, 'sensor', "nefit_"+params.serialNumber.toString()+"_temp_override_temp_setpoint", {
            avty_t: TOPIC_PREFIX+"/available",
            device: AUTODISCOVER_DEVICE,
            device_class: 'temperature',
            unique_id: "nefit_"+params.serialNumber.toString()+"_temp_override_temp_setpoint",
            name: AUTODISCOVER_NAME+"_temp_override_temp_setpoint",
            state_topic: TOPIC_PREFIX+"/temp_override_temp_setpoint",
            unit_of_measurement: '°C',
        });
        publishAutoDiscover(mqttClient, 'sensor', "nefit_"+params.serialNumber.toString()+"_current_switchpoint", {
            avty_t: TOPIC_PREFIX+"/available",
            device: AUTODISCOVER_DEVICE,
            device_class: 'temperature',
            unique_id: "nefit_"+params.serialNumber.toString()+"_current_switchpoint",
            name: AUTODISCOVER_NAME+"_current_switchpoint",
            state_topic: TOPIC_PREFIX+"/current_switchpoint",
            unit_of_measurement: '°C',
        });

        publishAutoDiscover(mqttClient, 'sensor', "nefit_"+params.serialNumber.toString()+"_pressure", {
            avty_t: TOPIC_PREFIX+"/available",
            device: AUTODISCOVER_DEVICE,
            device_class: 'pressure',
            unique_id: "nefit_"+params.serialNumber.toString()+"_pressure",
            name: AUTODISCOVER_NAME+"_pressure",
            state_topic: TOPIC_PREFIX+"/pressure",
            unit_of_measurement: 'hPa',
        });
        publishAutoDiscover(mqttClient, 'binary_sensor', "nefit_"+params.serialNumber.toString()+"_hot_water_active", {
            avty_t: TOPIC_PREFIX+"/available",
            device: AUTODISCOVER_DEVICE,
            unique_id: "nefit_"+params.serialNumber.toString()+"_hot_water_active",
            name: AUTODISCOVER_NAME+"_hot_water_active",
            state_topic: TOPIC_PREFIX+"/hot_water_active",
            payload_on: "1",
            payload_off: "0",
        });
        publishAutoDiscover(mqttClient, 'binary_sensor', "nefit_"+params.serialNumber.toString()+"_boiler_indicator", {
            avty_t: TOPIC_PREFIX+"/available",
            device: AUTODISCOVER_DEVICE,
            unique_id: "nefit_"+params.serialNumber.toString()+"_boiler_indicator",
            name: AUTODISCOVER_NAME+"_boiler_indicator",
            state_topic: TOPIC_PREFIX+"/boiler_indicator",
            payload_on: "on",
            payload_off: "off",
        });
        publishAutoDiscover(mqttClient, 'sensor', "nefit_"+params.serialNumber.toString()+"_control", {
            avty_t: TOPIC_PREFIX+"/available",
            device: AUTODISCOVER_DEVICE,
            unique_id: "nefit_"+params.serialNumber.toString()+"_control",
            name: AUTODISCOVER_NAME+"_control",
            state_topic: TOPIC_PREFIX+"/control",
        });
        publishAutoDiscover(mqttClient, 'sensor', "nefit_"+params.serialNumber.toString()+"_user_mode", {
            avty_t: TOPIC_PREFIX+"/available",
            device: AUTODISCOVER_DEVICE,
            unique_id: "nefit_"+params.serialNumber.toString()+"_user_mode",
            name: AUTODISCOVER_NAME+"_user_mode",
            state_topic: TOPIC_PREFIX+"/user_mode",
        });
        publishAutoDiscover(mqttClient, 'sensor', "nefit_"+params.serialNumber.toString()+"_clock_program", {
            avty_t: TOPIC_PREFIX+"/available",
            device: AUTODISCOVER_DEVICE,
            unique_id: "nefit_"+params.serialNumber.toString()+"_clock_program",
            name: AUTODISCOVER_NAME+"_clock_program",
            state_topic: TOPIC_PREFIX+"/clock_program",
        });
        publishAutoDiscover(mqttClient, 'sensor', "nefit_"+params.serialNumber.toString()+"_outdoor_source_type", {
            avty_t: TOPIC_PREFIX+"/available",
            device: AUTODISCOVER_DEVICE,
            unique_id: "nefit_"+params.serialNumber.toString()+"_outdoor_source_type",
            name: AUTODISCOVER_NAME+"_outdoor_source_type",
            state_topic: TOPIC_PREFIX+"/outdoor_source_type",
        });

        console.log("Published auto discovery");

        mqttClient.publish(TOPIC_PREFIX+"/available", 'online');

        await mqttClient.subscribe(TOPIC_PREFIX.concat("/command/+"))
        mqttClient.on('message', function(topic, message){
            console.log(topic)
            handleMessage(nefitClient, mqttClient, topic, message);
        });
        return publishStatus(nefitClient, mqttClient);
    })
    .catch((e) => {
        mqttClient.publish(TOPIC_PREFIX+"/available", 'offline');

        console.error('error', e)
    }).finally(async () => {
        nefitClient.end();
        await mqttClient.end();        
    });
