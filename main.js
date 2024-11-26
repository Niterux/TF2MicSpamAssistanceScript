const fs = require('node:fs')
const child = require('node:child_process')
const
{
    default: RCON
} = require('rcon-srcds')
const http = require('node:http')
const
{
    XMLParser
} = require("fast-xml-parser")
const
{
    decode
} = require('html-entities')

const parser = new XMLParser(
{
    ignoreAttributes: false,
    alwaysCreateTextNode: true,
    processEntities: false
})


const conLogPath =
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Team Fortress 2\\tf\\console.log'
const TF2Path =
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Team Fortress 2\\tf_win64.exe'
const VLCPath = 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe'
const playlistPath = 'E:\\Hella Gud Christmas Playlist\\christmas.m3u'
const possibleChars = 'qwertyuiopasdfghjklzxcvbnm'
const TF2Port = 27015
const VLCPort = 9090
const refreshMilliseconds = 100
let authRetryCounter = 11
let password = ''

for (let i = 0; i < 20; i++)
{
    password += possibleChars[Math.floor(Math.random() * possibleChars.length)]
}

const TF2Args = `-steam
-novid
-nojoy
-nosteamcontroller
-nohltv
-particles 1
-precachefontchars
-condebug
-conclearlog
-usercon
+ip 127.0.0.1
+sv_rcon_whitelist_address 127.0.0.1
+rcon_password ${password}
+hostport ${TF2Port}
+net_start`.split('\n')

let fileSize = 0
let allNewChunks = ''
let firstRead = false
let VLCPaused = false

function readNewLines()
{
    const readStream = fs.createReadStream(conLogPath,
    {
        encoding: 'utf8',
        start: fileSize
    })

    readStream.on('data', (chunk) =>
    {
        allNewChunks += chunk
    })

    readStream.on('end', () =>
    {
        fileSize += allNewChunks.length
        allNewChunks.replaceAll('\r', '')
        let lines = allNewChunks.split('\n')
        allNewChunks = ""
        // Wait for a while before checking for new data
        setTimeout(() =>
        {
            readNewLines()
            checkMetaData()
        }, refreshMilliseconds)
        if (!firstRead)
        {
            firstRead = true
            return
        }
        for (i = 0; i < lines.length; i++)
        {
            if (lines[i].startsWith(
                    "(Demo Support) Start recording demos"))
            {
                sendTF2Command("+voicerecord;voice_loopback 1")
                setTimeout(function ()
                {
                    sendTF2Command("-voicerecord")
                }, 40)
            }
            if (lines[i].startsWith("(Demo Support) End recording") ||
                lines[i].startsWith("VLCPAUSE") ||
                lines[i].startsWith("You have switched to team"))
            {
                pauseVLC(true)
                sendTF2Command("-voicerecord")
            }
            if (lines[i].startsWith("VLCNEXT"))
            {
                sendVLCCommand("pl_next")
                sendTF2Command("+voicerecord")
            }
            if (lines[i].startsWith("VLCPLAY"))
            {
                pauseVLC(false)
                sendTF2Command("+voicerecord")
            }
            if (lines[i].startsWith("VLCINFO"))
            {
                announceSong(true)
            }
        }

    })

    readStream.on('error', (err) =>
    {
        console.error('Error reading the file:', err)
    })
}


const teamFortress = child.spawn(TF2Path, TF2Args)
teamFortress.on('exit', (code) =>
{
    process.exit()
})
const VLC = child.spawn(VLCPath, [playlistPath, "--http-host=127.0.0.1",
    `--http-port=${VLCPort}`, `--http-password=${password}`
])
VLC.on('exit', (code) => process.exit())
const RCONClient = new RCON(
{
    port: TF2Port,
    encoding: 'utf8'
})

let authRetry

function tryAuth()
{
    authRetry = setTimeout(function ()
    {
        console.log("Attempting RCON connection to TF2")
        RCONClient.authenticate(password)
            .then(RCONSUCCESS)
            .catch(function (e)
            {
                console.error(e)
                tryAuth()
            })
        authRetryCounter--
        if (!authRetryCounter)
            throw "Could not establish RCON connection to TF2"
    }, 5000)
}
tryAuth()


let chatString = ''
let timestampString = ' at 0:00/0:00'

function RCONSUCCESS()
{
    console.log('authenticated')
    console.log('password:' + password)
    clearInterval(authRetry)
    pauseVLC(true)
    readNewLines()
}

function checkMetaData()
{
    http.get(`http://:${password}@127.0.0.1:${VLCPort}/requests/status.xml`, (res) =>
        {
            const
            {
                statusCode
            } = res
            const contentType = res.headers['content-type']

            let error
            // Any 2xx status code signals a successful response but
            // here we're only checking for 200.
            if (statusCode !== 200)
            {
                error = new Error('Request Failed.\n' +
                    `Status Code: ${statusCode}`)
            }
            else if (!/^text\/xml/.test(contentType))
            {
                error = new Error('Invalid content-type.\n' +
                    `Expected text/xml but received ${contentType}`)
            }
            if (error)
            {
                console.error(error.message)
                // Consume response data to free up memory
                res.resume()
                return
            }

            res.setEncoding('utf8')
            let rawData = ''
            res.on('data', (chunk) =>
            {
                rawData += chunk
            })
            res.on('end', () =>
            {
                try
                {
                    let jObj = parser.parse(rawData)
                    timestampString =
                        ` Currently at ${Math.floor(jObj.root.time["#text"] / 60)}:${(jObj.root.time["#text"] % 60).toString().padStart(2, '0')}/${Math.floor(jObj.root.length["#text"] / 60)}:${(jObj.root.length["#text"] % 60).toString().padStart(2, '0')}.`
                    if (jObj.root.state["#text"] != "playing")
                    {
                        VLCPaused = true
                        return
                    }
                    VLCPaused = false
                    let totalInfos = jObj.root.information.category
                        .length
                    let metaInfo = []
                    let metaData = ['NO ARTIST METADATA',
                        'NO TITLE METADATA'
                    ]
                    for (i = 0; i < totalInfos; i++)
                        if (jObj.root.information.category[i][
                                "@_name"
                            ] == 'meta') metaInfo = jObj.root
                            .information.category[i].info
                    for (i = 0; i < metaInfo.length; i++)
                    {
                        if (metaInfo[i]['@_name'] == 'artist')
                            metaData[0] = metaInfo[i]['#text']
                        if (metaInfo[i]['@_name'] == 'title')
                            metaData[1] = metaInfo[i]['#text']
                    }
                    let tempString =
                        ` Playing: ${metaData[0]} - ${metaData[1]}.`
                    tempString = decode(decode(
                        tempString
                    )) //this has to be decoded twice, VLC WHY!!!!! (&amp;amp;)
                    if (chatString == tempString)
                        return
                    chatString = tempString
                    announceSong()
                }
                catch (e)
                {
                    console.error(e.message)
                }
            })
        })
        .on('error', (e) =>
        {
            console.error(`Got error: ${e.message}`)
        })
}

function announceSong(timestamp)
{
    if (!timestamp)
    {
        RCONClient.execute(formatChatMessage(`Now${chatString}`))
    }
    else
    {
        RCONClient.execute(formatChatMessage(
            `Currently${chatString + timestampString}`))
    }
}

function sendVLCCommand(command)
{
    http.get(
        `http://:${password}@127.0.0.1:${VLCPort}/requests/status.xml?command=${command}`
    )
}
async function sendTF2Command(command)
{
    return await RCONClient.execute(command)
}

function pauseVLC(pause)
{
    if (VLCPaused != pause)
    {
        sendVLCCommand('pl_pause')
        VLCPaused = pause
    }
}

function formatChatMessage(message)
{
    message.replaceAll('"', "''")
    if (message.length > 127)
    {
        message = message.slice(0, 124)
        message += '...'
    }
    return 'say_team ' + message
}