const request = require('request')
const xml2js = require('xml2js')
const url = require('url')

class Device {
  constructor (url) {
    this.url = url
    this.services = [
      'urn:schemas-upnp-org:service:WANIPConnection:1',
      'urn:schemas-upnp-org:service:WANIPConnection:2',
      'urn:schemas-upnp-org:service:WANPPPConnection:1'
    ]
  }

  run (action, args, callback) {
    const self = this

    this._getService(this.services, function (err, info) {
      if (err) return callback(err)

      const body = '<?xml version="1.0"?>' +
               '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
                 's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
                 '<s:Body>' +
                   '<u:' + action + ' xmlns:u=' + JSON.stringify(info.service) + '>' +
                     args.map((args) => {
                       return '<' + args[0] + '>' +
                             (args[1] ? args[1] : '') +
                             '</' + args[0] + '>'
                     }).join('') +
                   '</u:' + action + '>' +
                 '</s:Body>' +
               '</s:Envelope>'

      request({
        method: 'POST',
        url: info.controlURL,
        headers: {
          'Content-Type': 'text/xml; charset="utf-8"',
          'Content-Length': Buffer.byteLength(body),
          Connection: 'close',
          SOAPAction: JSON.stringify(info.service + '#' + action)
        },
        body: body
      }, function (err, res, data) {
        if (err) return callback(err)

        if (res.statusCode !== 200) {
          return callback(new Error('Request failed: ' + res.statusCode))
        }

        const parser = new xml2js.Parser()
        parser.parseString(data, function (err, body) {
          if (err) return callback(err)

          const soapns = self._getNamespace(
            body,
            'http://schemas.xmlsoap.org/soap/envelope/'
          )

          callback(null, body[soapns + 'Body'])
        })
      })
    })
  }

  _getService (types, callback) {
    const self = this

    this._getXml(this.url, function (err, info) {
      if (err) return callback(err)

      const s = self._parseDescription(info).services.filter(function (service) {
        return types.indexOf(service.serviceType) !== -1
      })

      // Use the first available service
      if (s.length === 0 || !s[0].controlURL || !s[0].SCPDURL) {
        return callback(new Error('Service not found'))
      }

      const base = new URL(info.baseURL || self.url)
      function addPrefix (u) {
        let uri
        try {
          uri = new URL(u)
        } catch (err) {
          // Is only the path of the URL
          uri = new URL(u, base.href)
        }

        uri.host = uri.host || base.host
        uri.protocol = uri.protocol || base.protocol

        return url.format(uri)
      }

      callback(null, {
        service: s[0].serviceType,
        SCPDURL: addPrefix(s[0].SCPDURL),
        controlURL: addPrefix(s[0].controlURL)
      })
    })
  }

  _getXml (url, callback) {
    request(url, function (err, res, data) {
      if (err) return callback(err)

      if (res.statusCode !== 200) {
        return callback(new Error('Request failed: ', res.statusCode))
      }

      const parser = new xml2js.Parser()
      parser.parseString(data, function (err, body) {
        if (err) return callback(err)

        callback(null, body)
      })
    })
  }

  _parseDescription (info) {
    const services = []
    const devices = []

    function toArray (item) {
      return Array.isArray(item) ? item : [item]
    }

    function traverseServices (service) {
      if (!service) return
      services.push(service)
    }

    function traverseDevices (device) {
      if (!device) return
      devices.push(device)

      if (device.deviceList && device.deviceList.device) {
        toArray(device.deviceList.device).forEach(traverseDevices)
      }

      if (device.serviceList && device.serviceList.service) {
        toArray(device.serviceList.service).forEach(traverseServices)
      }
    }

    traverseDevices(info.device)

    return {
      services: services,
      devices: devices
    }
  }

  _getNamespace (data, uri) {
    let ns

    if (data['@']) {
      Object.keys(data['@']).some(function (key) {
        if (!/^xmlns:/.test(key)) return
        if (data['@'][key] !== uri) return

        ns = key.replace(/^xmlns:/, '')
        return true
      })
    }

    return ns ? ns + ':' : ''
  }
}

module.exports = Device
