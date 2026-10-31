import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Switch, TextInput, View } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { useTheme } from '@/theme';
import type { BotCommand } from '@/types';
import { Avatar } from './Avatar';
import { BotBadge } from './BotBadge';
import { IconBtn } from './IconBtn';
import { Pressable } from './Pressable';
import { Sheet } from './Sheet';
import { Text } from './Text';

function CommandDescription({ text }: { text: string }) {
  const theme = useTheme();
  const marker = text.toLowerCase().indexOf('only you');
  if (marker < 0) return <Text variant="caption" color={theme.colors.text3}>{text}</Text>;
  const openParen = text.lastIndexOf('(', marker);
  const closeParen = text.indexOf(')', marker);
  const start = openParen >= 0 ? openParen : marker;
  const end = closeParen >= 0 ? closeParen + 1 : text.length;
  return (
    <Text variant="caption" color={theme.colors.text3}>
      {text.slice(0, start)}
      <Text variant="caption" color="#FACC15" style={{ fontWeight: '600' }}>{text.slice(start, end)}</Text>
      {text.slice(end)}
    </Text>
  );
}

export function BotCommandPicker({ open, onClose, commands, serverUrl, initialCommand, initialText, onInvoke }: {
  open: boolean;
  onClose: () => void;
  commands: BotCommand[];
  serverUrl?: string | null;
  initialCommand?: BotCommand | null;
  initialText?: string;
  onInvoke: (command: BotCommand, options: Record<string, string | number | boolean>) => Promise<boolean>;
}) {
  const theme = useTheme();
  const [selected, setSelected] = useState<BotCommand | null>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedBotId, setSelectedBotId] = useState<string>('all');
  const bots = Array.from(new Map(commands.map((command) => [command.botId, {
    id: command.botId,
    name: command.botDisplayName ?? command.botUsername,
  }])).values());
  const visibleCommands = selectedBotId === 'all'
    ? commands
    : commands.filter((command) => command.botId === selectedBotId);

  useEffect(() => {
    if (!open) return;
    setSelected(initialCommand ?? null);
    setSelectedBotId(initialCommand?.botId ?? 'all');
    setError(null);
    const args = (initialText ?? '').trim().split(/\s+/).slice(1);
    const next: Record<string, string | boolean> = {};
    (initialCommand?.options ?? []).forEach((option, index) => {
      next[option.name] = option.type === 'boolean' ? args[index] === 'true' : (args[index] ?? '');
    });
    setValues(next);
  }, [initialCommand, initialText, open]);

  const choose = (command: BotCommand) => {
    setSelected(command);
    setValues(Object.fromEntries(command.options.map((option) => [option.name, option.type === 'boolean' ? false : ''])));
    setError(null);
  };

  const submit = async () => {
    if (!selected) return;
    const missing = selected.options.find((option) => option.required && !values[option.name] && values[option.name] !== false);
    if (missing) return setError(`${missing.name} is required.`);
    const options: Record<string, string | number | boolean> = {};
    for (const option of selected.options) {
      const value = values[option.name];
      if (option.type === 'integer') {
        const parsed = Number(value);
        if (value !== '' && !Number.isInteger(parsed)) return setError(`${option.name} must be a whole number.`);
        if (value !== '') options[option.name] = parsed;
      } else if (option.type === 'boolean') {
        options[option.name] = value === true;
      } else if (typeof value === 'string' && value.trim()) {
        options[option.name] = value.trim();
      }
    }
    setSubmitting(true);
    setError(null);
    const ok = await onInvoke(selected, options);
    setSubmitting(false);
    if (ok) onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} maxHeightFraction={0.82}>
      <View style={{ flex: 1, paddingHorizontal: 16, paddingBottom: 24 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          {selected ? <IconBtn icon={ChevronLeft} accessibilityLabel="Back to commands" onPress={() => setSelected(null)} /> : null}
          <Text variant="subtitle" style={{ flex: 1 }}>{selected ? `/${selected.name}` : 'Bot commands'}</Text>
          {selected ? <BotBadge /> : null}
        </View>

        {selected ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <Avatar username={selected.botUsername} uri={selected.botAvatar} baseUrl={serverUrl} size={32} />
              <View style={{ flex: 1 }}>
                <Text variant="bodySmall" style={{ fontWeight: '600' }}>{selected.botDisplayName ?? selected.botUsername}</Text>
                <CommandDescription text={selected.description} />
              </View>
            </View>
            {selected.options.map((option) => (
              <View key={option.name} style={{ gap: 5 }}>
                <Text variant="bodySmall" style={{ fontWeight: '600' }}>
                  {option.name}{option.required ? ' *' : ''}
                </Text>
                <Text variant="caption" color={theme.colors.text3}>{option.description}</Text>
                {option.type === 'boolean' ? (
                  <Switch
                    value={values[option.name] === true}
                    onValueChange={(value) => setValues((current) => ({ ...current, [option.name]: value }))}
                    trackColor={{ false: theme.colors.bgElev2, true: theme.colors.accent }}
                  />
                ) : (
                  <TextInput
                    value={String(values[option.name] ?? '')}
                    onChangeText={(value) => setValues((current) => ({ ...current, [option.name]: value }))}
                    keyboardType={option.type === 'integer' ? 'number-pad' : 'default'}
                    autoCapitalize="none"
                    placeholder={option.type === 'user' ? 'Username or user ID' : option.type === 'channel' ? 'Channel ID' : option.name}
                    placeholderTextColor={theme.colors.text3}
                    style={{ color: theme.colors.text, backgroundColor: theme.colors.bgElev2, borderColor: theme.colors.lineSoft, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 }}
                  />
                )}
              </View>
            ))}
            {error ? <Text variant="caption" color={theme.colors.danger}>{error}</Text> : null}
            <Pressable haptic disabled={submitting} onPress={() => { void submit(); }} style={{ minHeight: 44, borderRadius: 10, backgroundColor: theme.colors.accent }}>
              {submitting ? <ActivityIndicator color={theme.colors.textOnAccent} /> : <Text variant="subtitle" color={theme.colors.textOnAccent}>Use /{selected.name}</Text>}
            </Pressable>
          </ScrollView>
        ) : (
          <View style={{ flex: 1, gap: 10 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 7 }}>
              {[{ id: 'all', name: 'All' }, ...bots].map((bot) => {
                const active = selectedBotId === bot.id;
                return (
                  <Pressable
                    key={bot.id}
                    haptic
                    minHit={36}
                    onPress={() => setSelectedBotId(bot.id)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: active ? theme.colors.accent : theme.colors.lineSoft,
                      backgroundColor: active ? theme.colors.accent + '22' : theme.colors.bgElev2,
                    }}
                  >
                    <Text variant="caption" color={active ? theme.colors.accent : theme.colors.text2} style={{ fontWeight: '700' }}>
                      {bot.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <ScrollView contentContainerStyle={{ gap: 8 }}>
            {visibleCommands.length ? visibleCommands.map((command) => (
              <Pressable key={`${command.botId}:${command.name}`} haptic onPress={() => choose(command)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.lineSoft, backgroundColor: theme.colors.bgElev1 }}>
                <Avatar username={command.botUsername} uri={command.botAvatar} baseUrl={serverUrl} size={34} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text variant="bodySmall" style={{ fontWeight: '700' }}>/{command.name}</Text>
                    <Text variant="caption" color={theme.colors.text3}>{command.botDisplayName ?? command.botUsername}</Text>
                  </View>
                  <CommandDescription text={command.description} />
                </View>
              </Pressable>
            )) : <Text variant="bodySmall" color={theme.colors.text3}>No bot commands are available.</Text>}
            </ScrollView>
          </View>
        )}
      </View>
    </Sheet>
  );
}
