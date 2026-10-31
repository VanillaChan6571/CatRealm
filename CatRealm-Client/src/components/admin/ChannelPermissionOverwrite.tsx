import { useState } from 'react';
import { X, Check, Minus } from 'lucide-react';
import { api } from '../../lib/api';
import { PERMISSION_CATEGORIES, CHANNEL_OVERWRITE_CATEGORY_KEYS } from './permissionDefinitions';

interface PermissionOverwrite {
  id: string;
  channel_id?: string;
  category_id?: string;
  target_type: 'role' | 'user';
  target_id: string;
  allow: number;
  deny: number;
}

interface Props {
  resourceId: string;
  resourceType?: 'channels' | 'categories';
  overwrite: PermissionOverwrite;
  targetName: string;
  onUpdate: () => void;
  onDelete: () => void;
}

function toPermissionBits(value: number): bigint {
  if (!Number.isFinite(value)) return 0n;
  const normalized = Math.trunc(value);
  // Legacy signed-32 values should be interpreted as unsigned masks.
  if (normalized < 0) return BigInt(normalized >>> 0);
  return BigInt(normalized);
}

export function ChannelPermissionOverwrite({
  resourceId,
  resourceType = 'channels',
  overwrite,
  targetName,
  onUpdate,
  onDelete,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [allow, setAllow] = useState(overwrite.allow);
  const [deny, setDeny] = useState(overwrite.deny);
  const scopePath = resourceType === 'categories' ? 'categories' : 'channels';

  const togglePermission = async (bit: number) => {
    const mask = toPermissionBits(bit);
    if (mask === 0n) return;

    let newAllowBits = toPermissionBits(allow);
    let newDenyBits = toPermissionBits(deny);

    // Current state
    const isAllowed = (newAllowBits & mask) === mask;
    const isDenied = (newDenyBits & mask) === mask;

    if (!isAllowed && !isDenied) {
      // Inherit -> Allow
      newAllowBits |= mask;
    } else if (isAllowed) {
      // Allow -> Deny
      newAllowBits &= ~mask;
      newDenyBits |= mask;
    } else {
      // Deny -> Inherit
      newDenyBits &= ~mask;
    }

    if (newAllowBits > BigInt(Number.MAX_SAFE_INTEGER) || newDenyBits > BigInt(Number.MAX_SAFE_INTEGER)) {
      console.error('Permission bit overflow: unable to store overwrite safely');
      return;
    }

    const newAllow = Number(newAllowBits);
    const newDeny = Number(newDenyBits);

    setAllow(newAllow);
    setDeny(newDeny);

    try {
      await api.patch(`/api/${scopePath}/${resourceId}/permissions/${overwrite.id}`, {
        allow: newAllow,
        deny: newDeny
      });
      onUpdate();
    } catch (err) {
      console.error('Failed to update permission', err);
      setAllow(overwrite.allow);
      setDeny(overwrite.deny);
    }
  };

  const getPermissionState = (bit: number): 'allow' | 'deny' | 'inherit' => {
    const mask = toPermissionBits(bit);
    if (mask === 0n) return 'inherit';
    if ((toPermissionBits(allow) & mask) === mask) return 'allow';
    if ((toPermissionBits(deny) & mask) === mask) return 'deny';
    return 'inherit';
  };

  const handleDelete = async () => {
    if (!confirm(`Remove permission overwrite for ${targetName}?`)) return;
    try {
      await api.delete(`/api/${scopePath}/${resourceId}/permissions/${overwrite.id}`);
      onDelete();
    } catch (err) {
      console.error('Failed to delete overwrite', err);
    }
  };

  return (
    <div className="border border-border rounded-lg bg-bg-elevated">
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-bg-hover/30"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-text-primary">
            {overwrite.target_type === 'role' ? '🎭' : '👤'} {targetName}
          </span>
          <span className="text-xs text-text-muted">
            ({overwrite.target_type})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleDelete();
            }}
            className="p-1 hover:bg-danger/20 rounded text-danger"
          >
            <X className="w-4 h-4" />
          </button>
          <span className={`transform transition-transform ${expanded ? 'rotate-180' : ''}`}>
            ▼
          </span>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border p-4 space-y-4">
          {CHANNEL_OVERWRITE_CATEGORY_KEYS.map((key) => {
            const category = PERMISSION_CATEGORIES[key];
            return (
              <div key={key}>
                <h4 className="text-sm font-semibold text-text-primary mb-2">{category.title}</h4>
                <div className="space-y-2">
                  {category.permissions.map((perm) => {
                    const state = getPermissionState(perm.bit);
                    return (
                      <div
                        key={perm.bit}
                        className="flex items-center justify-between p-2 rounded hover:bg-bg-hover/30"
                      >
                        <div>
                          <div className="text-sm text-text-primary">{perm.label}</div>
                          <div className="text-xs text-text-muted">{perm.description}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => togglePermission(perm.bit)}
                          className={`
                          flex items-center gap-1 px-3 py-1 rounded text-xs font-medium transition-colors
                          ${state === 'allow' ? 'bg-success/20 text-success' : ''}
                          ${state === 'deny' ? 'bg-danger/20 text-danger' : ''}
                          ${state === 'inherit' ? 'bg-bg-input text-text-muted' : ''}
                        `}
                        >
                          {state === 'allow' && <><Check className="w-3 h-3" /> Allow</>}
                          {state === 'deny' && <><X className="w-3 h-3" /> Deny</>}
                          {state === 'inherit' && <><Minus className="w-3 h-3" /> Inherit</>}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
