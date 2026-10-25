assert_lead_contract_in_managed_section() {
  local agents_file="$1"
  local managed_section lead_count
  managed_section="$(sed -n '/XQ_SQUAD_MANAGED_START/,/XQ_SQUAD_MANAGED_END/p' "$agents_file")"
  if ! printf '%s\n' "$managed_section" | grep -q 'You are the \*\*Agent Lead\*\*'; then
    echo "Lead contract missing from managed section in $agents_file" >&2
    return 1
  fi

  lead_count="$(grep -c 'You are the \*\*Agent Lead\*\*' "$agents_file" || true)"
  if [[ "$lead_count" != "1" ]]; then
    echo "expected exactly one Lead contract in $agents_file, found $lead_count" >&2
    return 1
  fi
}
