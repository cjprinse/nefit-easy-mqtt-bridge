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
  user_mode: 'clock',
  clock_program: 'auto',
  in_house_status: 'ok',
  in_house_temp: 21.3,
  hot_water_active: '1',
  boiler_indicator: 'off',
  control: 'weather',
  temp_override_duration: 0,
  current_switchpoint: 18,
  ps_active: '0',
  powersave_mode: '0',
  fp_active: '0',
  fireplace_mode: '0',
  temp_override: '0',
  holiday_mode: '0',
  temp_setpoint: 21,
  temp_override_temp_setpoint: 21,
  temp_manual_setpoint: 21,
  outdoor_temp: 9,
  outdoor_source_type: 'virtual',
  serial: '123456789',
  pressure: 1.5,
  supply_temperature: 39.6
}
```

# Commands

The bridge subscribes to the following topics
   
* /nefit/${serialnumber}/command/settemperature For valid values see  https://www.npmjs.com/package/nefit-easy-commands#set-temperature
* /nefit/${serialnumber}/command/setmode ['manual', 'clock']
* /nefit/${serialnumber}/command/sethotwatersupply ['on', 'off']
