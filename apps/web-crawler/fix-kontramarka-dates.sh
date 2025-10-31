#!/bin/bash

# Script to fix date selectors in all kontramarka.ua configs

BASE_DIR="crawl-configs/kontramarka.ua/kyiv"

echo "Fixing date selectors in kontramarka.ua configs..."
echo "=" | tr ' ' '=' | head -c 60 && echo

count=0
for config_file in "$BASE_DIR"/*/config.json; do
  if [[ ! -f "$config_file" ]]; then
    continue
  fi

  echo "Processing: $config_file"

  # Create backup
  cp "$config_file" "$config_file.bak"

  # Use jq to update date selectors
  jq '
    .selectors = [
      .selectors[] |
      if .name == "dateTimeIso" then
        empty
      elif .name == "dateTimeText" then
        empty
      elif .name == "date_time_from" then
        empty
      elif .name == "date_time_to" then
        empty
      else
        .
      end
    ] + [
      {
        "name": "time",
        "selector": ".cat_item .block-info__time",
        "type": "text",
        "multiple": true,
        "transform": "trim"
      }
    ]
  ' "$config_file" > "$config_file.tmp" && mv "$config_file.tmp" "$config_file"

  ((count++))
  echo "✓ Fixed $config_file"
done

echo
echo "=" | tr ' ' '=' | head -c 60 && echo
echo "✅ Fixed $count config files!"
echo
echo "Backups created with .bak extension"
echo "To restore: for f in crawl-configs/kontramarka.ua/kyiv/*/config.json.bak; do mv \"\$f\" \"\${f%.bak}\"; done"