---
numero: 0002
titre: Réseau Pixel→PC via ZeroTier et relais nginx VPS, pas tailscale serve
statut: accepté
date: 2026-09-19
concerne:
  - (D9) connexion HTTPS du client Android vers le PC
---

# 0002 — Réseau Pixel→PC via ZeroTier et relais nginx VPS, pas tailscale serve

## Contexte
La spec initiale (D9, §2bis) supposait **Tailscale** : `tailscale serve --https=443
http://localhost:<port>` pour exposer le service voix en HTTPS, avec certificat `*.ts.net`
valide automatiquement. Or l'utilisateur **n'a pas Tailscale** — il a **ZeroTier**
(vérifié : `zerotier-one_x64.exe` actif, PC = `10.77.208.239`, réseau `2873fd00f29112f8`).

ZeroTier n'a **pas** d'équivalent de `tailscale serve` : il assigne une IP privée maillée mais
n'expose ni HTTPS ni reverse-proxy ni certificat public. Or le getUserMedia Android Chrome exige
un **contexte sécurisé** (HTTPS à cert valide) pour le micro propre + l'installation PWA.

Le domaine de l'utilisateur (`*.srv759970.hstgr.cloud`) résout publiquement vers le **VPS**
(`69.62.108.82`), pas vers le PC — on ne peut pas pointer un enregistrement public vers une IP
ZeroTier privée. Mais le **VPS est lui-même sur le réseau ZeroTier** (`10.77.208.85`) et possède
déjà nginx + certbot + Let's Encrypt rodés sur dozens de vhosts.

## Décision
Topologie : le client Android parle en HTTPS public à un vhost `talk.srv759970.hstgr.cloud`
sur le **VPS** (cert LE valide, déploiement identique aux vhosts existants) ; le VPS **reverse-
proxies** vers le PC via le mesh ZeroTier (`10.77.208.239:<port>`). Le service est protégé
(HTTP basic-auth + token), comme les autres vhosts du VPS.

## Conséquences
- **Zéro gestion de certificat côté PC** : pas de Caddy, pas de zone DNS-01, pas de CA maison à
  importer dans Android. La Phase 0 Android (PWA installable, mic) marche avec l'infra LE déjà en
  place.
- **Coût** : l'audio voix (STT/TTS/stream) transite par le VPS → +1 saut maillé (latence
  faible) et le service est servi sur une hostname publique du VPS (authentifiée, pas exposé en
  clair). Dérive par rapport au « rien d'exposé sur Internet » absolu de la spec — la voix est sur
  le VPS, pas directement exposée à Internet.
- **Ce qui devient plus difficile** : un vrai isolement maillé pur (audio jamais hors du mesh)
  exigerait une zone DNS cloud avec API + DNS ZeroTier + Caddy sur le PC — re-grillé en v2 si le
  relais VPS se révèle gênant.

## Alternatives écartées
- **`tailscale serve`** : impossible, Tailscale absent.
- **DNS-01 sur le PC + zone DNS cloud** : exige une zone DNS avec API (Hostinger wildcard n'en
  fournit pas) + ZeroTier DNS + Caddy PC. Plus de pièces mobiles pour un bénéfice (isolement
  maillé pur) non prioritaire en v1. Re-grillé en v2.
- **mkcert auto-signé + CA importée Android** : fragile pour les PWA (Chrome se méfie des CA
  utilisateur), rechargement CA à chaque changement. Relevé comme repli de démo seulement.
- **Phase 0 sans HTTPS (self-signed manuel)** : mic possible mais PWA/écran-verrouillé dégradé.
