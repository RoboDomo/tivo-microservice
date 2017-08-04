// tivo-microservice

process.env.DEBUG='TiVoHost,HostBase'

const debug    = require('debug')('TiVoHost'),
      config   = require('./config'),
      net      = require('net'),
      HostBase = require('microservice-core/HostBase')

const topicRoot = process.env.TOPIC_ROOT || 'tivo',
      mqttHost  = process.env.MQTT_HOST || 'mqtt://ha'

const irCodes = [
    'UP', 'DOWN', 'LEFT', 'RIGHT', 'SELECT', 'TIVO', 'LIVETV', 'GUIDE', 'INFO', 'EXIT',
    'THUMBSUP', 'THUMBSDOWN', 'CHANNELUP', 'CHANNELDOWN', 'MUTE', 'VOLUMEUP', 'VOLUMEDOWN', 'TVINPUT',
    'VIDEO_MODE_FIXED_480i', 'VIDEO_MODE_FIXED_480p', 'VIDEO_MODE_FIXED_720p', 'VIDEO_MODE_FIXED_1080i',
    'VIDEO_MODE_HYBRID', 'VIDEO_MODE_HYBRID_720p', 'VIDEO_MODE_HYBRID_1080i', 'VIDEO_MODE_NATIVE',
    'CC_ON', 'CC_OFF',
    'OPTIONS',
    'ASPECT_CORRECTION_FULL', 'ASPECT_CORRECTION_PANEL', 'ASPECT_CORRECTION_ZOOM', 'ASPECT_CORRECTION_WIDE_ZOOM',
    'PLAY', 'FORWARD', 'REVERSE', 'PAUSE', 'SLOW', 'REPLAY', 'ADVANCE', 'RECORD',
    'NUM0', 'NUM1', 'NUM2', 'NUM3', 'NUM4', 'NUM5', 'NUM6', 'NUM7', 'NUM8', 'NUM9',
    'ENTER', 'CLEAR',
    'ACTION_A', 'ACTION_B', 'ACTION_C', 'ACTION_D'
]

class TiVoHost extends HostBase {
    constructor(config) {
        super(mqttHost, topicRoot + '/' + config.device)
        debug('construct TivoHost', config)

        this.device = config.device
        this.ip     = config.ip
        this.logged = false
        this.connect()
    }

    connect() {
        this.tivo = new net.Socket()
        this.tivo.setEncoding('ascii')
        this.buffer = ''
        this.tivo.on('error', (err) => {
            this.tivo.end()
            this.tivo = null
            this.connect()
        })
        if (!this.logged) {
            debug('connecting', this.device, this.ip)
            this.logged = true
        }
        this.tivo.connect(31339, this.ip, () => {
            debug('CONNECTED', this.device, this.ip)
        })
        this.tivo.on('data', (data) => {
            this.buffer += data.toString()
            // debug(this.device, 'data', this.buffer, '\n')
            while (this.buffer.indexOf('\r') !== -1) {
                const lines = this.buffer.split('\r'),
                      line  = lines.shift()

                // debug('line', line)
                this.buffer = lines.join('\r')
                this.handleResponse(line)
                this.emit('tivo', line)
            }
        })
    }

    handleResponse(line) {
        const [command, channel, reason] = line.split(' '),
              state                      = this.state

        debug('handleResponse', line)
        switch (command) {
            case 'LIVETV_READY':
                this.state = {mode: 'LIVETV'}
                if (state.setChannel) {
                    this.channel(state.channel)
                    this.state = {setChannel: false}
                }
                break
            case 'CH_STATUS':
                this.state = {
                    mode:    'LIVETV',
                    channel: channel,
                    reason:  reason
                }
                break
        }
    }

    /**
     * Write a command to the socket, terminated with a carriage return.
     * @param cmd
     */
    write(cmd) {
        const out = cmd + '\r'
        debug(this.device, 'write', out)
        this.tivo.write(out)
    }

    async command(type, arg) {
        debug(this.device, 'command', type, arg)
        if (irCodes.indexOf(arg) !== -1) {
            this.ircode(arg)
        }
        else if (arg.substr(0,1) === '0') {
            this.channel(arg)
        }
        else {
            return Promise.reject(new Error(`Invalid command "${arg}"`))
        }
        return Promise.resolve()
    }

    /**
     * Tune TiVo to specified channel
     * @param {String} num channel number to tune, including lead zero.
     * @param force if true, will stop any recording if there are no tuners available.
     */
    channel(num, force) {
        debug('channel', num)
        num.split('').forEach((key) => {
            this.ircode('NUM' + key)
        })
        this.ircode('ENTER')
    }

    /**
     * Send an IR Code to the TiVo.
     * @param {String} code (TIVO, LIVETV, etc.)
     */
    ircode(code) {
        const command = `IRCODE ${code}`

        debug('ircode', command)
        this.write(command)
    }
}

const tivos = {}

function main() {
    config.forEach((cfg) => {
        tivos[cfg.device] = new TiVoHost(cfg)
    })
}

main()

