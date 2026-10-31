import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Edit2, Trash2, Users } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { resolveRoleIconUrl } from '../../utils/avatar';

interface Role {
  id: string;
  name: string;
  color: string | null;
  permissions: number;
  position: number;
  is_default: boolean | number;
  mentionable: boolean | number;
  icon?: string | null;
  style_type?: string | null;
}

interface RoleCardProps {
  role: Role;
  memberCount?: number;
  onEdit: (role: Role) => void;
  onDelete: (roleId: string) => void;
  children?: React.ReactNode;
}

export function RoleCard({ role, memberCount = 0, onEdit, onDelete, children }: RoleCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const isDefault = !!role.is_default;
  const isMentionable = !!role.mentionable;
  const styleType = role.style_type ?? 'solid';

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDefault) {
      alert('Cannot delete default role');
      return;
    }
    if (confirm(`Are you sure you want to delete the role "${role.name}"?`)) {
      onDelete(role.id);
    }
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit(role);
  };

  return (
    <div className="bg-gray-800/50 rounded-lg overflow-hidden border border-gray-700/50">
      <div
        className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-800/70 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3 flex-1">
          <button
            type="button"
            className="text-gray-400 hover:text-gray-300"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
          >
            {isExpanded ? (
              <ChevronDown className="w-5 h-5" />
            ) : (
              <ChevronRight className="w-5 h-5" />
            )}
          </button>

          <div className="flex items-center gap-3 flex-1">
            <div
              className="w-3 h-3 rounded-full"
              style={{
                backgroundColor: role.color || '#99AAB5',
              }}
            />
            {resolveRoleIconUrl(role.icon, serverUrl) && (
              <img src={resolveRoleIconUrl(role.icon, serverUrl)!} alt="" className="w-5 h-5 object-contain rounded" />
            )}
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-200">{role.name}</span>
                {isDefault && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-600/20 text-blue-400">
                    Default
                  </span>
                )}
                {isMentionable && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-600/20 text-green-400">
                    Mentionable
                  </span>
                )}
                {styleType !== 'solid' && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-purple-600/20 text-purple-400">
                    {styleType === 'gradient' ? 'Gradient' : styleType === 'glow' ? 'Glow' : 'RGB'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 text-sm text-gray-400 mt-1">
                <Users className="w-3 h-3" />
                <span>{memberCount} members</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleEdit}
            className="p-2 rounded-lg hover:bg-gray-700/50 text-gray-400 hover:text-gray-300 transition-colors"
            title="Edit role"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          {!isDefault && (
            <button
              type="button"
              onClick={handleDelete}
              className="p-2 rounded-lg hover:bg-red-600/20 text-gray-400 hover:text-red-400 transition-colors"
              title="Delete role"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {isExpanded && children && (
        <div className="border-t border-gray-700/50 p-4 bg-gray-900/30">
          {children}
        </div>
      )}
    </div>
  );
}
