#! /usr/bin/env bash

set -x

python -m venv venv

if [ -n "$PROXY_URL" ]
then
  ./venv/bin/pip install -r ./requirements.txt --proxy "$PROXY_URL"
else
  ./venv/bin/pip install -r ./requirements.txt
fi
