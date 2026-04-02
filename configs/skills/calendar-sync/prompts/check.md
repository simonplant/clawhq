# Calendar Sync — Check Prompt

Review the next 48 hours of calendar events.

## Check For

1. **Conflicts**: Overlapping events (same time slot, different location/meeting)
2. **Back-to-back**: Meetings with <10 min buffer (flag if 3+ in a row)
3. **Overloaded days**: >4 hours of meetings = no deep work window
4. **Focus opportunities**: 2h+ free windows on weekdays = suggest protecting as focus blocks

## Output

If issues found:
- List each conflict or overload with specific times
- Suggest focus block times if available

If calendar is healthy: output nothing. Silence is correct.
