#!/usr/bin/env python3
"""Fix ContextForge call_tool direct-proxy identity pass-through (patch v9b).

Corrects the user_context argument passed to invoke_tool_direct in the
direct-proxy branch of call_tool. It must be the UserContext OBJECT from
user_identity_var (same as list_tools via _proxy_list_tools_to_gateway),
NOT the raw user_context dict. build_identity_headers() accesses .user_id
on it, so a dict raises AttributeError and the call fails.
"""

FILE = "/app/mcpgateway/transports/streamablehttp_transport.py"

# Current (wrong) state: dict passed
WRONG = """                        user_email=user_email,
                        token_teams=token_teams,
                        user_context=user_context,
                    )"""

# Correct state: UserContext object (same as list_tools)
RIGHT = """                        user_email=user_email,
                        token_teams=token_teams,
                        user_context=user_identity_var.get(),
                    )"""


def main():
    with open(FILE, "r", encoding="utf-8") as f:
        content = f.read()

    if RIGHT in content:
        print("call_tool already passes user_identity_var.get() (correct). No change.")
        return

    if WRONG not in content:
        print("WRONG pattern not found; expected user_context=user_context in invoke_tool_direct call.")
        return

    content = content.replace(WRONG, RIGHT, 1)
    with open(FILE, "w", encoding="utf-8") as f:
        f.write(content)
    print("call_tool identity pass-through corrected to user_identity_var.get().")


if __name__ == "__main__":
    main()
