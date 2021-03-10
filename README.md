# nefit-easy-mqtt-bridge

Bridge metrics from nefit/buderus/bosch backend to a mqtt topic 
 
# Usage
 
* install dependencies using `npm install` or build a docker image using the provided Dockerfile
* set the correct environment variables (see below)
* run `node app.js`
 
# Configuration
 
The app is configured using multiple environment variables:

    NEFIT_SERIAL_NUMBER 
    NEFIT_ACCESS_KEY
    NEFIT_PASSWORD
    MQTT_URL
    MQTT_USERNAME
    MQTT_PASSWORD
    POLL_DELAY (in ms, defaults to 300000 -> 5 minutes)
    PUBLISH_TO_SEPERATE_TOPICS (boolean, defaults to false)
    TOPIC_PREFIX (defaults to /nefit/{serial})

# Topics

The bridge posts a JSON message to the topic `/nefit/${serialnumber}` with following keys

* 'setpoint'
* 'inhouse'
* 'outdoorTemp'
* 'overrideSetpoint'
* 'manualSetpoint'
* 'hotwaterActive'
* 'serial'
* 'pressure'
* 'supplyTemperature'

example 
```
{
  "setpoint": 21.5,
  "inhouse": 21.7,
  "outdoorTemp": 7,
  "overrideSetpoint": 21.5,
  "manualSetpoint": 15,
  "hotWaterActive": 1,
  "serial": "1234567",
  "pressure": 25.5,
  "supplyTemperature": 47.3
}
```

# Commands

The bridge subscribes to the following topics
   
* /nefit/${serialnumber}/command/settemperature For valid values see  https://www.npmjs.com/package/nefit-easy-commands#set-temperature
* /nefit/${serialnumber}/command/setmode ['manual', 'clock']
* /nefit/${serialnumber}/command/sethotwatersupply ['on', 'off']
