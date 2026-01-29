# Jeffsi Meet - Custom Jitsi Web Image
# Based on jitsi/web with custom web client code

FROM jitsi/web:stable

# Copy our custom built files
COPY libs/ /usr/share/jitsi-meet/libs/
COPY css/all.css /usr/share/jitsi-meet/css/all.css
COPY lang/ /usr/share/jitsi-meet/lang/
COPY images/ /usr/share/jitsi-meet/images/
COPY sounds/ /usr/share/jitsi-meet/sounds/
COPY fonts/ /usr/share/jitsi-meet/fonts/
COPY static/ /usr/share/jitsi-meet/static/
COPY resources/ /usr/share/jitsi-meet/resources/

# Copy HTML files
COPY *.html /usr/share/jitsi-meet/
COPY *.js /usr/share/jitsi-meet/

# Copy config templates
COPY config.js /defaults/config.js
COPY interface_config.js /defaults/interface_config.js
