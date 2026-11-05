// SPDX-License-Identifier: GPL-2.0-or-later
#include <obs-module.h>
#include <obs-frontend-api.h>
#include <util/platform.h>
#include <QApplication>
#include <QDir>
#include <QRegularExpression>
#include <QCheckBox>
#include <QComboBox>
#include <QFileDialog>
#include <QFileInfo>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QJsonDocument>
#include <QJsonObject>
#include <QLabel>
#include <QLineEdit>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPushButton>
#include <QSet>
#include <QSettings>
#include <QSlider>
#include <QTimer>
#include <QUrl>
#include <QVBoxLayout>
#include <QWebSocket>
#include <algorithm>
#include <cmath>
#include <memory>

OBS_DECLARE_MODULE()
OBS_MODULE_USE_DEFAULT_LOCALE("chat-pinger", "en-US")
MODULE_EXPORT const char *obs_module_description(void) { return "Kick chat sound notifications with a native OBS dock"; }

class PingerDock final : public QWidget {
    QLineEdit *channel;
    QComboBox *sound;
    QComboBox *routing;
    QSlider *volume;
    QLabel *status;
    QLabel *volumeLabel;
    QLabel *counter;
    QLabel *customLabel;
    QCheckBox *muted;
    QPushButton *connectButton;
    QPushButton *stopButton;
    QNetworkAccessManager network;
    QWebSocket *socket = nullptr;
    QTimer retry;
    QTimer watchdog;
    QSettings settings;
    QString customFile;
    QString room;
    QString slug;
    QSet<QString> seen;
    QStringList seenOrder;
    unsigned generation = 0;
    int attempt = 0;
    int count = 0;
    bool listening = false;
    bool subscribed = false;
    bool sourceConfigured = false;
    obs_source_t *audio = nullptr;

    static QString configPath() {
        char *path = obs_module_config_path("settings.ini");
        QString result = QString::fromUtf8(path); bfree(path);
        QDir().mkpath(QFileInfo(result).absolutePath());
        return result;
    }
    void save() {
        settings.setValue("channel", channel->text());
        settings.setValue("sound", sound->currentData());
        settings.setValue("volume", volume->value());
        settings.setValue("custom", customFile);
        settings.setValue("muted", muted->isChecked());
        settings.setValue("routing", routing->currentIndex());
    }
    QString parseChannel() {
        QString input = channel->text().trimmed();
        if (input.contains("://") || input.startsWith("kick.com/", Qt::CaseInsensitive) || input.startsWith("www.kick.com/", Qt::CaseInsensitive)) {
            QUrl url(input.contains("://") ? input : "https://" + input);
            if (url.scheme() != "https" || (url.host() != "kick.com" && url.host() != "www.kick.com") || url.port() != -1 || !url.userInfo().isEmpty()) return {};
            auto parts = url.path().split('/', Qt::SkipEmptyParts);
            if (parts.size() != 1) return {};
            input = parts.first();
        }
        static QRegularExpression pattern("^[a-zA-Z0-9_-]{1,50}$");
        const QStringList reserved = {"browse","categories","search","settings","login","signup","dashboard","api"};
        if (!pattern.match(input).hasMatch() || reserved.contains(input.toLower())) return {};
        return input.toLower();
    }
    void stop() {
        ++generation; listening = false; subscribed = false;
        retry.stop(); watchdog.stop();
        if (socket) { socket->disconnect(this); socket->close(); socket->deleteLater(); socket = nullptr; }
        connectButton->setEnabled(true); stopButton->setEnabled(false);
        status->setText("Monitoring stopped.");
    }
    void reconnect() {
        subscribed = false; watchdog.stop();
        if (!listening) return;
        int delay = std::min(30000, 1000 * (1 << std::min(attempt++, 5)));
        status->setText(QString("Connection lost. Retrying in %1s…").arg(delay / 1000));
        retry.start(delay);
    }
    void openSocket() {
        if (!listening) return;
        if (socket) { socket->disconnect(this); socket->abort(); socket->deleteLater(); }
        socket = new QWebSocket(QString(), QWebSocketProtocol::VersionLatest, this);
        auto *currentSocket = socket;
        const auto currentGeneration = generation;
        status->setText("Connecting to live chat…");
        watchdog.start(20000);
        QObject::connect(socket, &QWebSocket::disconnected, this, [this, currentSocket, currentGeneration] {
            if (socket == currentSocket && currentGeneration == generation) reconnect();
        });
        QObject::connect(socket, &QWebSocket::errorOccurred, this, [this, currentSocket, currentGeneration](QAbstractSocket::SocketError) {
            if (socket == currentSocket && currentGeneration == generation) {
                currentSocket->abort(); if (!retry.isActive()) reconnect();
            }
        });
        QObject::connect(socket, &QWebSocket::textMessageReceived, this, [this, currentSocket, currentGeneration](const QString &text) {
            if (currentGeneration != generation || socket != currentSocket) return;
            const auto frame = QJsonDocument::fromJson(text.toUtf8()).object();
            QJsonObject data = frame.value("data").isString() ? QJsonDocument::fromJson(frame.value("data").toString().toUtf8()).object() : frame.value("data").toObject();
            const auto event = frame.value("event").toString();
            watchdog.start(130000);
            if (event == "pusher:connection_established") {
                QJsonObject request{{"event", "pusher:subscribe"}, {"data", QJsonObject{{"auth", ""}, {"channel", "chatrooms." + room + ".v2"}}}};
                socket->sendTextMessage(QString::fromUtf8(QJsonDocument(request).toJson(QJsonDocument::Compact)));
            } else if (event == "pusher:ping") {
                socket->sendTextMessage("{\"event\":\"pusher:pong\",\"data\":{}}");
            } else if (event == "pusher_internal:subscription_succeeded" && frame.value("channel").toString() == "chatrooms." + room + ".v2") {
                subscribed = true; attempt = 0; status->setText("Listening to " + slug);
            } else if (event == "pusher:error" || event == "pusher:subscription_error") {
                socket->close();
            } else if (event == "App\\Events\\ChatMessageEvent" && subscribed && frame.value("channel").toString() == "chatrooms." + room + ".v2") {
                const auto rawId = data.value("id");
                const auto id = rawId.isString() ? rawId.toString() : rawId.isDouble() ? QString::number(rawId.toInteger()) : QString();
                if (id.isEmpty() || seen.contains(id)) return;
                seen.insert(id); seenOrder.append(id);
                if (seenOrder.size() > 2000) seen.remove(seenOrder.takeFirst());
                counter->setText(QString("%1 new messages").arg(++count));
                play(false);
            }
        });
        socket->open(QUrl("wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0&flash=false"));
    }
    void start() {
        const auto parsed = parseChannel();
        if (parsed.isEmpty()) { status->setText("Enter a channel name or https://kick.com/channel link."); return; }
        stop(); slug = parsed; listening = true; attempt = 0; count = 0; seen.clear(); seenOrder.clear();
        connectButton->setEnabled(false); stopButton->setEnabled(true); counter->setText("0 new messages"); save();
        status->setText("Finding channel…");
        QNetworkRequest request(QUrl("https://kick.com/api/v2/channels/" + slug));
        request.setRawHeader("Accept", "application/json");
        request.setHeader(QNetworkRequest::UserAgentHeader, "ChatPinger/0.1.0");
        request.setTransferTimeout(20000);
        auto *reply = network.get(request); const auto currentGeneration = generation;
        QObject::connect(reply, &QNetworkReply::finished, this, [this, reply, currentGeneration] {
            reply->deleteLater(); if (currentGeneration != generation || !listening) return;
            if (reply->error() != QNetworkReply::NoError) {
                auto message = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt() == 404 ? "Channel not found." : "Kick channel lookup failed: " + reply->errorString() + ". Public access may be blocked.";
                stop(); status->setText(message); return;
            }
            auto document = QJsonDocument::fromJson(reply->readAll());
            auto value = document.object().value("chatroom").toObject().value("id").toDouble();
            if (!std::isfinite(value) || value <= 0 || value > 9007199254740991.0 || std::floor(value) != value) { stop(); status->setText("Kick returned no chatroom. A website challenge or API change may be blocking access."); return; }
            room = QString::number(static_cast<qint64>(value)); openSocket();
        });
    }
    bool ensureSource() {
        if (audio && obs_source_removed(audio)) { obs_source_release(audio); audio = nullptr; sourceConfigured = false; }
        if (!audio) {
            auto *existing = obs_get_source_by_name("Chat Pinger Alerts");
            if (existing) {
                if (QString::fromUtf8(obs_source_get_id(existing)) != "ffmpeg_source") { obs_source_release(existing); status->setText("Rename the existing non-media source named Chat Pinger Alerts."); return false; }
                audio = existing;
            } else {
                obs_data_t *data = obs_data_create();
                obs_data_set_bool(data, "is_local_file", true); obs_data_set_bool(data, "looping", false);
                obs_data_set_bool(data, "restart_on_activate", false);
                audio = obs_source_create("ffmpeg_source", "Chat Pinger Alerts", data, nullptr);
                obs_data_release(data);
            }
            if (!audio) { status->setText("OBS Media Source is unavailable. Enable the obs-ffmpeg plugin."); return false; }
        }
        auto *current = obs_frontend_get_current_scene();
        auto *scene = current ? obs_scene_from_source(current) : nullptr;
        if (!scene) { if (current) obs_source_release(current); status->setText("Select a regular OBS scene to add the alert audio source."); return false; }
        auto *item = obs_scene_find_source(scene, obs_source_get_name(audio));
        if (!item) item = obs_scene_add(scene, audio);
        if (item) obs_sceneitem_set_visible(item, true);
        obs_source_release(current);
        obs_source_set_volume(audio, float(volume->value()) / 100.0f);
        obs_source_set_monitoring_type(audio, routing->currentIndex() == 0 ? OBS_MONITORING_TYPE_MONITOR_ONLY : OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT);
        return item != nullptr;
    }
    void play(bool preview) {
        if (!preview && muted->isChecked()) return;
        QString file;
        if (sound->currentData().toString() == "custom") file = customFile;
        else {
            const auto relative = QString("sounds/%1.wav").arg(sound->currentData().toString()).toUtf8();
            char *path = obs_module_file(relative.constData());
            if (path) { file = QString::fromUtf8(path); bfree(path); }
        }
        if (!QFileInfo(file).isFile()) { status->setText("Sound file is missing. Select another sound or import a file."); return; }
        if (!ensureSource()) return;
        obs_data_t *data = obs_source_get_settings(audio);
        const bool changed = QString::fromUtf8(obs_data_get_string(data, "local_file")) != file || !sourceConfigured;
        obs_data_set_string(data, "local_file", file.toUtf8().constData()); obs_data_set_bool(data, "is_local_file", true);
        obs_data_set_bool(data, "looping", false); obs_data_set_bool(data, "restart_on_activate", false);
        obs_data_set_bool(data, "close_when_inactive", true);
        if (changed) { obs_source_update(audio, data); sourceConfigured = true; } else obs_source_media_restart(audio);
        obs_data_release(data);
    }
public:
    PingerDock() : settings(configPath(), QSettings::IniFormat) {
        auto *layout = new QVBoxLayout(this);
        auto *intro = new QLabel("Every message. A little ping.\nConnect a Kick channel to hear new chat messages."); intro->setWordWrap(true); layout->addWidget(intro);
        auto *form = new QFormLayout;
        channel = new QLineEdit(settings.value("channel").toString()); channel->setPlaceholderText("https://kick.com/your-channel"); form->addRow("Channel", channel);
        sound = new QComboBox;
        sound->addItem("Short chime", "chime"); sound->addItem("Soft ping", "ping"); sound->addItem("Double bell", "bell"); sound->addItem("Retro messenger", "retro"); sound->addItem("Water drop", "drop"); sound->addItem("Custom sound", "custom");
        sound->setCurrentIndex(std::max(0, sound->findData(settings.value("sound", "chime")))); form->addRow("Sound", sound);
        auto *customButton = new QPushButton("Choose audio file…"); form->addRow("Custom audio", customButton);
        customFile = settings.value("custom").toString(); customLabel = new QLabel(QFileInfo(customFile).fileName()); customLabel->setWordWrap(true); form->addRow("", customLabel);
        volume = new QSlider(Qt::Horizontal); volume->setRange(0, 100); volume->setValue(std::clamp(settings.value("volume", 65).toInt(), 0, 100));
        volumeLabel = new QLabel(QString::number(volume->value()) + "%"); auto *volumeLayout = new QHBoxLayout; volumeLayout->addWidget(volume); volumeLayout->addWidget(volumeLabel); form->addRow("Volume", volumeLayout);
        routing = new QComboBox; routing->addItem("Headphones only (monitor)"); routing->addItem("Headphones + stream / recording"); routing->setCurrentIndex(std::clamp(settings.value("routing", 0).toInt(), 0, 1)); form->addRow("Output", routing);
        muted = new QCheckBox("Mute incoming alerts"); muted->setChecked(settings.value("muted", false).toBool()); form->addRow("", muted); layout->addLayout(form);
        auto *buttons = new QHBoxLayout; connectButton = new QPushButton("Start listening"); stopButton = new QPushButton("Stop"); stopButton->setEnabled(false); auto *test = new QPushButton("Test sound"); buttons->addWidget(connectButton); buttons->addWidget(stopButton); buttons->addWidget(test); layout->addLayout(buttons);
        status = new QLabel("Ready when you are."); status->setWordWrap(true); layout->addWidget(status); counter = new QLabel("0 new messages"); layout->addWidget(counter);
        auto *help = new QLabel("Set your headphones in OBS Settings → Audio → Advanced → Monitoring Device. Alerts use the Chat Pinger Alerts media source in the current scene. Busy chat restarts the short sound instead of stacking audio. Public Kick chat access can change or be blocked."); help->setWordWrap(true); layout->addWidget(help); layout->addStretch();
        retry.setSingleShot(true); watchdog.setSingleShot(true);
        QObject::connect(&retry, &QTimer::timeout, this, [this] { openSocket(); });
        QObject::connect(&watchdog, &QTimer::timeout, this, [this] { if (socket) { socket->abort(); if (!retry.isActive()) reconnect(); } });
        QObject::connect(connectButton, &QPushButton::clicked, this, [this] { start(); });
        QObject::connect(channel, &QLineEdit::returnPressed, this, [this] { start(); });
        QObject::connect(stopButton, &QPushButton::clicked, this, [this] { stop(); });
        QObject::connect(test, &QPushButton::clicked, this, [this] { play(true); });
        QObject::connect(customButton, &QPushButton::clicked, this, [this] {
            const auto file = QFileDialog::getOpenFileName(this, "Choose notification sound", customFile, "Audio (*.wav *.mp3 *.ogg *.flac)");
            if (!file.isEmpty()) {
                if (QFileInfo(file).size() > 10 * 1024 * 1024) { status->setText("Choose an audio file smaller than 10 MB."); return; }
                customFile = file; customLabel->setText(QFileInfo(file).fileName()); sound->setCurrentIndex(sound->findData("custom")); save();
            }
        });
        QObject::connect(volume, &QSlider::valueChanged, this, [this](int value) { volumeLabel->setText(QString::number(value) + "%"); if (audio) obs_source_set_volume(audio, float(value) / 100.0f); save(); });
        QObject::connect(sound, &QComboBox::currentIndexChanged, this, [this] { save(); });
        QObject::connect(routing, &QComboBox::currentIndexChanged, this, [this] { save(); });
        QObject::connect(muted, &QCheckBox::toggled, this, [this] { save(); });
    }
    ~PingerDock() override { stop(); save(); if (audio) { obs_source_media_stop(audio); obs_source_release(audio); } }
};

static PingerDock *dock = nullptr;
bool obs_module_load(void) {
    QMetaObject::invokeMethod(qApp, [] {
        dock = new PingerDock();
        if (!obs_frontend_add_dock_by_id("chat-pinger", "Chat Pinger", dock)) { delete dock; dock = nullptr; }
    }, Qt::QueuedConnection);
    return true;
}
void obs_module_unload(void) {
    if (dock) obs_frontend_remove_dock("chat-pinger");
    dock = nullptr;
}
