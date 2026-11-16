
interface Permission {
  key: string;
  label: string;
  description: string;
  bit: number;
}

interface PermissionCategoryProps {
  title: string;
  permissions: Permission[];
  rolePermissions: number;
  rolePermissionKeys?: string[];
  onToggle: (key: string, bit: number) => void;
  disabled?: boolean;
}

function toPermissionBits(value: number): bigint {
  if (!Number.isFinite(value)) return 0n;
  const normalized = Math.trunc(value);
  // Legacy signed-32 values should be interpreted as unsigned masks.
  if (normalized < 0) return BigInt(normalized >>> 0);
  return BigInt(normalized);
}

export function PermissionCategory({
  title,
  permissions,
  rolePermissions,
  rolePermissionKeys,
  onToggle,
  disabled = false,
}: PermissionCategoryProps) {
  const roleBits = toPermissionBits(rolePermissions);

  const hasPermission = (key: string, bit: number) => {
    if (Array.isArray(rolePermissionKeys)) return rolePermissionKeys.includes(key);
    const mask = toPermissionBits(bit);
    if (mask === 0n) return false;
    return (roleBits & mask) === mask;
  };

  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
        {title}
      </h3>
      <div className="space-y-2">
        {permissions.map((perm) => {
          const isEnabled = hasPermission(perm.key, perm.bit);

          return (
            <div
              key={perm.key}
              className="flex items-center justify-between p-3 rounded-lg bg-gray-800/50 hover:bg-gray-800/70 transition-colors"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-200">{perm.label}</span>
                </div>
                <p className="text-sm text-gray-400 mt-1">{perm.description}</p>
              </div>

              <button
                type="button"
                onClick={() => !disabled && onToggle(perm.key, perm.bit)}
                disabled={disabled}
                className={`
                  relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                  ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                  ${isEnabled ? 'bg-blue-600' : 'bg-gray-600'}
                `}
                role="switch"
                aria-checked={isEnabled}
                aria-label={`Toggle ${perm.label}`}
              >
                <span
                  className={`
                    inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                    ${isEnabled ? 'translate-x-6' : 'translate-x-1'}
                  `}
                />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
