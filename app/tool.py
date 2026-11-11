"""Kleine Verwaltungsbefehle fuer die Kommandozeile (im Container ausfuehren):

  python -m app.tool users              Benutzer auflisten
  python -m app.tool passwd NAME        Passwort neu setzen (z.B. wenn vergessen)
  python -m app.tool adduser NAME [admin|viewer]
  python -m app.tool version
"""
import getpass
import os
import sys

from . import config as cfgmod
from .auth import Auth
from .db import DB


def _pw() -> str:
    if not sys.stdin.isatty():
        return sys.stdin.readline().rstrip("\n")
    a = getpass.getpass("Neues Passwort: ")
    if a != getpass.getpass("Wiederholen: "):
        sys.exit("Die Passwoerter stimmen nicht ueberein.")
    return a


def main() -> None:
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    if args[0] == "version":
        from .main import VERSION
        print(VERSION)
        return
    cfg = cfgmod.load()
    auth = Auth(DB(os.path.join(cfg.storage.path, "kestrel.db")))
    try:
        if args[0] == "users":
            for u in auth.users():
                print("%-20s %s" % (u["username"], u["role"]))
        elif args[0] == "passwd" and len(args) == 2:
            u = [x for x in auth.users() if x["username"].lower() == args[1].lower()]
            if not u:
                sys.exit("Benutzer nicht gefunden.")
            auth.update_user(u[0]["id"], password=_pw())
            print("Passwort gesetzt, alle Sitzungen von %s wurden beendet." % u[0]["username"])
        elif args[0] == "adduser" and len(args) in (2, 3):
            auth.create_user(args[1], _pw(), args[2] if len(args) == 3 else "viewer")
            print("Benutzer angelegt.")
        else:
            sys.exit(__doc__)
    except ValueError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
