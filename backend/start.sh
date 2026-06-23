#!/usr/bin/env bash

chmod +x pocketbase
./pocketbase serve --http=0.0.0.0:8090 &

node server.js