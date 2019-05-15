import https from 'https'
import http from 'http'
import httpProxy from 'http-proxy'
import express from 'express'
import morgan from 'morgan'
import bodyParser from 'body-parser'
import { join, resolve, dirname } from 'path'
import { readdir, stat, writeFile, readFile, existsSync } from 'fs-extra'
import { transform } from '@babel/core'
import { URL } from 'url'
import cors from 'cors'

const babelOptions = {
  presets: ['@babel/env'],
  plugins: [
    '@babel/plugin-transform-strict-mode',
    '@babel/plugin-proposal-object-rest-spread',
    '@babel/plugin-transform-for-of'
  ]
}

const fileOptions = { encoding: 'utf-8' }

const projectPath = join(dirname(require.main.filename), 'blackhole')

console.log('PROJECT PATH:', projectPath)

const boxURL = 'https://dev.box.blackhole.marm.altarix.org'

/**
 * removes hash from filename
 * @param {String} fileName
 * @returns {Stirng}
 */
const hashlessFileName = fileName => {
  // remove hash from filename
  return fileName.replace(/(.*)(-[0-9a-f]*)(\..*)/, (match, p1, p2, p3) => `${p1}${p3}`)
}

/**
 * get hash from filename
 * @param {String} fileName
 * @returns {(String | undefined)}
 */
const fileNameHash = fileName => {
  const match = fileName.match(/(?:.*)(-[0-9a-f]*)(?:\..*)/)
  if (match) {
    return match[1]
  }
}

// Create a HTTP Proxy server with a HTTPS target
const proxy = httpProxy.createProxyServer({
  target: boxURL,
  agent: https.globalAgent,
  headers: {
    host: new URL(boxURL).host
  }
})

proxy.on('error', (err, req, res) => {
  return res.status(500).send({
    error: err,
    message: 'An error occured in the proxy'
  })
})

proxy.on('proxyRes', function(proxyRes, req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization')
})

const app = express()
app.use(morgan('dev'))
app.use(cors())
// app.options('*', cors())
app.use(express.static(join(__dirname, 'static')))
app.post('/sync', [
  bodyParser.urlencoded({ extended: true }),
  bodyParser.json(),
  async (req, res, next) => {
    const { get: interests, filters, lastUptime } = req.body

    console.log('INTERESTS:', interests)

    const result = {
      code: 200,
      data: [
        {
          /*view: [], controller: [], style: [], model: [], printform: [], service: [], translation: []*/
        }
      ]
    }

    const uptime = Math.floor(Date.now() / 1000)

    const jsItems = ['controller', 'service']
    const jsonItems = ['view', 'style', 'model', 'printform', 'translation', 'file']

    for (const item of interests) {
      if (!result.data[0][item]) {
        result.data[0][item] = []
      }

      const itemsPath = join(projectPath, `${item}s`)
      if (existsSync(itemsPath)) {
        const files = await readdir(itemsPath)
        for (const fileName of files) {
          const filePath = join(itemsPath, fileName)
          const content = await readFile(filePath, fileOptions)

          if (jsItems.includes(item)) {
            const transpilled = transform(content, babelOptions)
            // const { code } = UglifyJS.minify(transpilled.code, { mangle: false })
            result.data[0][item].push({
              name: hashlessFileName(fileName).replace(/\..*$/, ''),
              code: transpilled.code,
              uptime,
              id: fileNameHash(fileName)
            })
          } else if (jsonItems.includes(item)) {
            try {
              const obj = JSON.parse(content)
              obj.uptime = uptime
              result.data[0][item].push(obj)
            } catch (e) {
              console.log('UNABLE TO PARSE:', fileName)
              console.error(e)
            }
          }
        }
      } else {
        console.log(`${itemsPath} does not exist`)
      }
    }

    res.setHeader('Content-Type', 'Application/json')
    result.data[0].serverUptime = uptime
    res.json(result)
  }
])

app.use((req, res) =>
  proxy.web(req, res, {
    target: boxURL,
    secure: true,
    changeOrigin: true
  })
)

app.use((req, res, next) => {
  res
    .status(404)
    .type('text/plain')
    .send("Route doesn't exist")
})

app.use((err, req, res, next) => {
  console.error(err.stack)
  res
    .status(500)
    .type('text/plain')
    .send('Oops... Internal server error')
})

const httpServer = http.createServer(app)
httpServer.listen(9999)
