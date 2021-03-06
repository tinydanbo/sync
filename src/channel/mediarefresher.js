var Vimeo = require("cytube-mediaquery/lib/provider/vimeo");
var ChannelModule = require("./module");
var Config = require("../config");
var InfoGetter = require("../get-info");
import { LoggerFactory } from '@calzoneman/jsli';

const LOGGER = LoggerFactory.getLogger('mediarefresher');

function MediaRefresherModule(channel) {
    ChannelModule.apply(this, arguments);
    this._interval = false;
    this._media = null;
    this._playlist = channel.modules.playlist;
}

MediaRefresherModule.prototype = Object.create(ChannelModule.prototype);

MediaRefresherModule.prototype.onPreMediaChange = function (data, cb) {
    if (this._interval) clearInterval(this._interval);

    this._media = data;
    var pl = this._playlist;

    switch (data.type) {
        case "gd":
            pl._refreshing = true;
            return this.initGoogleDocs(data, function () {

                pl._refreshing = false;
                cb(null, ChannelModule.PASSTHROUGH);
            });
        case "vi":
            pl._refreshing = true;
            return this.initVimeo(data, function () {
                pl._refreshing = false;
                cb(null, ChannelModule.PASSTHROUGH);
            });
        case "vm":
            pl._refreshing = true;
            return this.initVidme(data, function () {
                pl._refreshing = false;
                cb(null, ChannelModule.PASSTHROUGH);
            });
        default:
            return cb(null, ChannelModule.PASSTHROUGH);
    }
};

MediaRefresherModule.prototype.unload = function () {
    try {
        clearInterval(this._interval);
        this._interval = null;
    } catch (error) {
        LOGGER.error(error.stack);
    }
};

MediaRefresherModule.prototype.initGoogleDocs = function (data, cb) {
    var self = this;
    self.refreshGoogleDocs(data, cb);

    /*
     * Refresh every 55 minutes.
     * The expiration is 1 hour, but refresh 5 minutes early to be safe
     */
    self._interval = setInterval(function () {
        self.refreshGoogleDocs(data);
    }, 55 * 60 * 1000);
};

MediaRefresherModule.prototype.initVimeo = function (data, cb) {
    if (!Config.get("vimeo-workaround")) {
        if (cb) cb();
        return;
    }

    const self = this;
    self.channel.refCounter.ref("MediaRefresherModule::initVimeo");
    Vimeo.extract(data.id).then(function (direct) {
        if (self.dead || self.channel.dead) {
            self.unload();
            return;
        }

        if (self._media === data) {
            data.meta.direct = direct;
            self.channel.logger.log("[mediarefresher] Refreshed vimeo video with ID " +
                data.id);
        }

        if (cb) cb();
    }).catch(function (err) {
        LOGGER.error("Unexpected vimeo::extract() fail: " + err.stack);
        if (cb) cb();
    }).finally(() => {
        self.channel.refCounter.unref("MediaRefresherModule::initVimeo");
    });
};

MediaRefresherModule.prototype.refreshGoogleDocs = function (media, cb) {
    var self = this;

    if (self.dead || self.channel.dead) {
        self.unload();
        return;
    }

    self.channel.refCounter.ref("MediaRefresherModule::refreshGoogleDocs");
    InfoGetter.getMedia(media.id, "gd", function (err, data) {
        if (self.dead || self.channel.dead) {
            return;
        }

        if (typeof err === "string") {
            err = err.replace(/Google Drive lookup failed for [\w-]+: /, "");
            err = err.replace(/Forbidden/, "Access Denied");
            err = err.replace(/You don't have permission to access this video\./,
                    "Access Denied");
        }

        switch (err) {
            case "Moved Temporarily":
                self.channel.logger.log("[mediarefresher] Google Docs refresh failed " +
                        "(likely redirect to login page-- make sure it is shared " +
                        "correctly)");
                self.channel.refCounter.unref("MediaRefresherModule::refreshGoogleDocs");
                if (cb) cb();
                return;
            case "Access Denied":
            case "Not Found":
            case "Internal Server Error":
            case "Service Unavailable":
            case "Google Drive does not permit videos longer than 1 hour to be played":
            case "Google Drive videos must be shared publicly":
                self.channel.logger.log("[mediarefresher] Google Docs refresh failed: " +
                    err);
                self.channel.refCounter.unref("MediaRefresherModule::refreshGoogleDocs");
                if (cb) cb();
                return;
            default:
                if (err) {
                    self.channel.logger.log("[mediarefresher] Google Docs refresh failed: " +
                        err);
                    LOGGER.error("Google Docs refresh failed for ID " + media.id +
                        ": " + err);
                    self.channel.refCounter.unref("MediaRefresherModule::refreshGoogleDocs");
                    if (cb) cb();
                    return;
                }
        }

        if (media !== self._media) {
            self.channel.refCounter.unref("MediaRefresherModule::refreshGoogleDocs");
            if (cb) cb();
            return;
        }

        self.channel.logger.log("[mediarefresher] Refreshed Google Docs video with ID " +
            media.id);
        media.meta = data.meta;
        self.channel.refCounter.unref("MediaRefresherModule::refreshGoogleDocs");
        if (cb) cb();
    });
};

MediaRefresherModule.prototype.initVidme = function (data, cb) {
    var self = this;
    self.refreshVidme(data, cb);

    /*
     * Refresh every 55 minutes.
     * The expiration is 1 hour, but refresh 5 minutes early to be safe
     */
    self._interval = setInterval(function () {
        self.refreshVidme(data);
    }, 55 * 60 * 1000);
};

MediaRefresherModule.prototype.refreshVidme = function (media, cb) {
    var self = this;

    if (self.dead || self.channel.dead) {
        self.unload();
        return;
    }

    self.channel.refCounter.ref("MediaRefresherModule::refreshVidme");
    InfoGetter.getMedia(media.id, "vm", function (err, data) {
        if (self.dead || self.channel.dead) {
            return;
        }

        if (err) {
            self.channel.logger.log("[mediarefresher] Vidme refresh failed: " + err);
            self.channel.refCounter.unref("MediaRefresherModule::refreshVidme");
            if (cb) {
                process.nextTick(cb);
            }
            return;
        }

        if (media !== self._media) {
            self.channel.refCounter.unref("MediaRefresherModule::refreshVidme");
            if (cb) {
                process.nextTick(cb);
            }
            return;
        }

        self.channel.logger.log("[mediarefresher] Refreshed Vidme video with ID " +
            media.id);
        media.meta = data.meta;
        self.channel.refCounter.unref("MediaRefresherModule::refreshVidme");
        if (cb) {
            process.nextTick(cb);
        }
    });
}

module.exports = MediaRefresherModule;
