import { Link } from "@tanstack/react-router";

import { Menu, MenuGroup, MenuItem } from "@app/components/v2";

export const DefaultSideBar = () => (
  <Menu>
    <MenuGroup title="Organization Control">
      <Link to="/organization/audit-logs">
        {({ isActive }) => (
          <MenuItem isSelected={isActive} icon="moving-block">
            Audit Logs
          </MenuItem>
        )}
      </Link>
      {(window.location.origin.includes("https://app.infisical.com") ||
        window.location.origin.includes("https://eu.infisical.com") ||
        window.location.origin.includes("https://gamma.infisical.com")) && (
        <Link to="/organization/billing">
          {({ isActive }) => (
            <MenuItem isSelected={isActive} icon="spinning-coin">
              Usage & Billing
            </MenuItem>
          )}
        </Link>
      )}
    </MenuGroup>
    <MenuGroup title="Other">
      <Link to="/organization/access-management">
        {({ isActive }) => (
          <MenuItem isSelected={isActive} icon="groups">
            Access Control
          </MenuItem>
        )}
      </Link>
      <Link to="/organization/app-connections">
        {({ isActive }) => (
          <MenuItem isSelected={isActive} icon="jigsaw-puzzle">
            App Connections
          </MenuItem>
        )}
      </Link>
      <Link to="/organization/gateways">
        {({ isActive }) => (
          <MenuItem isSelected={isActive} icon="gateway" iconMode="reverse">
            Gateways
          </MenuItem>
        )}
      </Link>
      <Link to="/organization/settings">
        {({ isActive }) => (
          <MenuItem isSelected={isActive} icon="toggle-settings">
            Organization Settings
          </MenuItem>
        )}
      </Link>
    </MenuGroup>
  </Menu>
);
