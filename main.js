import {default as RCON} from "rcon-srcds";
import {XMLParser} from "fast-xml-parser";
import {decode} from "html-entities";
import * as toml from "jsr:@std/toml";

const parser = new XMLParser({
    ignoreAttributes: false, alwaysCreateTextNode: true, processEntities: false, //FIX: while changing songs VLC may fail to respond with stream info
    //this causes FXP to assume that category should be an object instead of array
    isArray: (_tagName, jPath, _isLeafNode, _isAttribute,) => {
        return jPath === "root.information.category" || jPath === "root.information.category.info";
    },
},);
const TF2Password = generateRandomString();
const VLCPassword = generateRandomString();
const VLCPlayWord = generateRandomString();
const VLCPauseWord = generateRandomString();
const VLCInfoWord = generateRandomString();
const VLCNextWord = generateRandomString();
const defaultConfig = {
    TF2: {
        TF2Path: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Team Fortress 2\\tf_win64.exe",
        ConLogPath: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Team Fortress 2\\tf\\console.log",
        TF2Port: 27015,
        MaxAuthRetries: 10,
        LinuxLineEndings: false,
        TF2LaunchArguments: "-novid\n" + "-nojoy\n" + "-nosteamcontroller\n" + "-nohltv\n" + "-particles 1\n" + "-precachefontchars\n"
    }, VLC: {
        VLCPath: "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",
        PlaylistPath: "E:\\Hella Gud Christmas Playlist\\christmas.m3u",
        VLCPort: 9090
    }, Other: {RefreshMilliseconds: 400}
}

let config;
let fileSize = 0;
let firstRead = false;
let chatString = "";
let timestampString = " at 0:00/0:00";
let authRetry;
let authRetryCounter = 0;
let TF2Args;
let VLCArgs;

function loadConfig() {
    let failedRead = false;
    let TOMLObj;
    try {
        const decoder = new TextDecoder("utf-8");
        const TOMLText = decoder.decode(Deno.readFileSync("config.toml"));
        TOMLObj = toml.parse(TOMLText);
    } catch (e) {
        failedRead = true;
        if (e instanceof Error && e.name === "NotFound") {
            console.warn("Warning: Could not find config.toml file, default config will be used.")
        } else {
            console.error(e)
        }
    }
    if (!failedRead) {
        config = recursiveMerge(defaultConfig, TOMLObj);
    } else {
        config = defaultConfig;
    }
    const TF2BuiltInArgs = `-steam
-condebug
-conclearlog
-usercon
+ip 127.0.0.1
-port ${config.TF2.TF2Port}
+sv_rcon_whitelist_address 127.0.0.1
+rcon_password ${TF2Password}
+net_start`.split("\n");
    TF2Args = [...TF2BuiltInArgs, ...config.TF2.TF2LaunchArguments.split("\n")];
    VLCArgs = `${config.VLC.PlaylistPath}
--extraintf=http
--http-host=127.0.0.1
--http-port=${config.VLC.VLCPort}
--http-password=${VLCPassword}`.split("\n");
}

async function readStreamAsText(stream, format) {
    const decoder = new TextDecoder(format);
    let text = "";
    let wholeBufferLength = 0;
    for await (const chunk of stream) {
        text += decoder.decode(chunk, {stream: true});
        wholeBufferLength += chunk.length;
    }
    return {text: text, size: wholeBufferLength};
}

async function readNewLines() {
    const conLogFileHandle = await Deno.open(config.TF2.ConLogPath, {read: true});
    await conLogFileHandle.seek(fileSize, Deno.SeekMode.Start);
    const streamData = await readStreamAsText(conLogFileHandle.readable, "utf-8");
    fileSize += streamData.size;
    const lines = streamData.text.split(config.TF2.LinuxLineEndings ? "\n" : "\r\n");
    // Wait for a while before checking for new data
    setTimeout(() => {
        readNewLines();
        checkMetaData();
    }, config.Other.RefreshMilliseconds);
    if (streamData.size === 0) {
        return;
    }
    if (!firstRead) {
        firstRead = true;
        return;
    }
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith("(Demo Support) Start recording demos",)) {
            sendTF2Command("+voicerecord;-voicerecord");
        }
        /*We use includes instead of startsWith because of a bug in the source engine where it doesn't guarantee that
                        consecutive echo commands should be on their own line*/
        if (lines[i].startsWith("(Demo Support) End recording") || lines[i].includes(`${VLCPauseWord} `) || lines[i].startsWith("You have switched to team")) {
            await sendVLCCommand("pl_forcepause");
            sendTF2Command("-voicerecord");
        }
        if (lines[i].includes(`${VLCNextWord} `)) {
            await sendVLCCommand("pl_next");
            sendTF2Command("+voicerecord");
        }
        if (lines[i].includes(`${VLCPlayWord} `)) {
            await sendVLCCommand("pl_forceresume");
            sendTF2Command("+voicerecord");
        }
        if (lines[i].includes(`${VLCInfoWord} `)) {
            announceSong(true);
        }
    }
    return;
}

function beforeUnload() {
    try {
        VLC.kill();
    } catch {
        //ignore
    }
    try {
        teamFortress.kill();
    } catch {
        //ignore
    }
}

/**
 * Generates a random cryptographic string
 */
function generateRandomString() {
    const possibleChars = "abcdefghijklmnopqrstuvwxyz";
    const randNumbers = crypto.getRandomValues(new Uint32Array(32));

    let randomString = "";
    for (let i = 0; i < randNumbers.length; i++) {
        randomString += possibleChars[randNumbers[i] % possibleChars.length];
    }
    return randomString;
}

function tryAuth() {
    authRetry = setTimeout(function () {
        console.log("Attempting RCON connection to TF2");
        if (authRetryCounter++ === config.TF2.MaxAuthRetries) {
            throw "Could not establish RCON connection to TF2";
        }
        RCONClient.authenticate(TF2Password)
            .then(RCONSuccess)
            .catch(function (e) {
                if (e.message.includes("ECONNREFUSED")) {
                    tryAuth();
                } else if (e.message.includes("Unable to authenticate")) {
                    console.error("UNABLE TO AUTHENTICATE, TRY CLOSING TF2");
                    Deno.exit(1);
                } else {
                    console.error(e);
                    Deno.exit(1);
                }
            });
    }, 5000);
}

async function RCONSuccess() {
    console.log("Authenticated with TF2");
    sendTF2Command(`alias VLCPLAY "echo ${VLCPlayWord}"
        alias VLCPAUSE "echo ${VLCPauseWord}"
        alias VLCINFO "echo ${VLCInfoWord}"
        alias VLCNEXT "echo ${VLCNextWord}"
        voice_loopback 1
        ds_enable 2`);
    clearInterval(authRetry);
    await sendVLCCommand("pl_forcepause");
    await readNewLines();
}

async function checkMetaData() {
    const response = await fetch(`http://:${VLCPassword}@127.0.0.1:${config.VLC.VLCPort}/requests/status.xml`,);
    if (!response.ok || response.body === null) {
        return false;
    }
    const jObj = parser.parse(await response.text());
    const TSTime = convertSecondsToTimestamp(jObj.root.time["#text"], 1);
    const TSLength = convertSecondsToTimestamp(jObj.root.length["#text"], 1);
    timestampString = ` Currently at ${TSTime}/${TSLength}.`;
    if (jObj.root.state["#text"] != "playing") {
        return true;
    }
    let metaInfo = [];
    let artistName = "";
    let titleName = "";
    let fileName = "";
    for (const cat of jObj.root.information.category) {
        if (cat["@_name"] === "meta") {
            metaInfo = cat.info;
        }
    }
    for (const info of metaInfo) {
        switch (info["@_name"]) {
            case "artist":
                artistName = info["#text"];
                break;
            case "title":
                titleName = info["#text"];
                break;
            case "filename":
                fileName = info["#text"];
                break;
        }
    }
    let tempString;
    const incompleteMeta = artistName === "" || titleName === "";
    if (incompleteMeta) {
        tempString = ` Playing: ${fileName}.`;
    } else {
        tempString = ` Playing: ${artistName} - ${titleName}.`;
    }

    // This has to be decoded twice
    tempString = decode(decode(tempString, {level: "xml"}), {level: "html5"});
    if (chatString === tempString) {
        return true;
    }
    if (incompleteMeta) {
        console.warn(`Invalid metadata in: ${fileName}, title: ${titleName}, artist: ${artistName}.
fix this using Mp3tag or similar.`,);
    }
    chatString = tempString;
    announceSong(false);
    return true;
}

function announceSong(timestamp) {
    if (!timestamp) {
        RCONClient.execute(formatChatMessage(`Now${chatString}`));
    } else {
        RCONClient.execute(formatChatMessage(`Currently${chatString + timestampString}`,));
    }
}

function sendVLCCommand(command) {
    return fetch(`http://:${VLCPassword}@127.0.0.1:${config.VLC.VLCPort}/requests/status.xml?command=${command}`, {method: "HEAD"},);
}

function sendTF2Command(command) {
    RCONClient.execute(command);
}

/**
 * Formats a message to be a TF2 team chat command.
 * @param message original text to be converted to a command
 */
function formatChatMessage(message) {
    message.replaceAll('"', "''");
    if (message.length > 127) {
        message = message.slice(0, 124);
        message += "...";
    }
    return "say_team " + message;
}

// I don't know what I'll do with seconds over 59 hours long
/**
 * Returns a string of the seconds formatted as a timestamp (5:54)
 * @param seconds Seconds to use for the calculation.
 * @param minSeparators Minimum amount of ":" in the result.
 */
function convertSecondsToTimestamp(seconds, minSeparators,) {
    if (seconds < 0) {
        seconds = 0;
    }
    if (minSeparators === undefined || minSeparators < 0) {
        minSeparators = 0;
    }
    minSeparators = Math.floor(minSeparators);
    const calculatedSeparators = Math.floor(Math.max(Math.log(seconds), 0) / Math.log(60),);
    const separators = Math.max(calculatedSeparators, minSeparators,);
    const outputTimes = [];
    for (let i = separators; i >= 0; i--) {
        const addedSegment = (Math.floor(seconds % 60)).toString();
        if (i === 0) {
            outputTimes.unshift(addedSegment.padStart(1, "0"));
        } else {
            outputTimes.unshift(addedSegment.padStart(2, "0"));
        }
        seconds /= 60;
    }
    return outputTimes.join(":");
}

function recursiveMerge(base, overlay) {
    let newObject
    if (Array.isArray(base) && !Array.isArray(overlay)) {
        newObject = Object.assign({}, base);
    } else {
        newObject = structuredClone(base);
    }
    for (const key of Object.keys(overlay)) {
        if (overlay[key].constructor !== base[key].constructor) continue;
        if (typeof overlay[key] === "object" && typeof base[key] === "object") {
            newObject[key] = recursiveMerge(base[key], overlay[key]);
        } else {
            newObject[key] = overlay[key];
        }
    }
    return newObject;
}

loadConfig()
console.debug(`VLC HTTP Password: ${VLCPassword}`);
const teamFortress = new Deno.Command(config.TF2.TF2Path, {args: TF2Args}).spawn();
teamFortress.output().then(() => {
    Deno.exit(0);
});
const VLC = new Deno.Command(config.VLC.VLCPath, {args: VLCArgs}).spawn();
VLC.output().then(() => {
    Deno.exit(0);
});
Deno.addSignalListener("SIGINT", beforeUnload);
globalThis.addEventListener("unload", beforeUnload);
const RCONClient = new RCON.default({
    port: config.TF2.TF2Port, encoding: "utf8",
},);
tryAuth();