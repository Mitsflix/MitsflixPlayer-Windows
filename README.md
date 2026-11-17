<p align="center"><img src="src/assets/wordmark.png" alt="Mitsflix" width="420"></p>

<h1 align="center">Mitsflix Player for Windows and Linux</h1>

<p align="center">Live TV, movies and series from any IPTV playlist — on your Windows or Linux PC or laptop.</p>

<p align="center">
  <a href="https://github.com/Mitsflix/MitsflixPlayer-Windows/releases/latest/download/MitsflixPlayer-Setup.exe"><img alt="Download for Windows" src="https://img.shields.io/badge/Download-Windows-E3A72F?style=for-the-badge&logo=windows&logoColor=white"></a>
  <a href="https://mitsflix.com"><img alt="Get a playlist" src="https://img.shields.io/badge/Get%20a%20playlist-mitsflix.com-E3A72F?style=for-the-badge"></a>
</p>

---

## 📥 Install

1. Download **[MitsflixPlayer-Setup.exe](https://github.com/Mitsflix/MitsflixPlayer-Windows/releases/latest/download/MitsflixPlayer-Setup.exe)**
2. Open it. If Windows shows **"Windows protected your PC"**, click **More info → Run anyway**
3. Add your playlist and start watching

Works on Windows 10 and 11 (64-bit). The app updates itself when a new version is out.

On a TV box or Fire Stick? Use the Android version: Downloader code **6284643**.

### Linux

- **Ubuntu, Debian, Mint:** download **[MitsflixPlayer.deb](https://github.com/Mitsflix/MitsflixPlayer-Windows/releases/latest/download/MitsflixPlayer.deb)** and open it, or run `sudo apt install ./MitsflixPlayer.deb`
- **Other Linux systems:** download **[MitsflixPlayer.AppImage](https://github.com/Mitsflix/MitsflixPlayer-Windows/releases/latest/download/MitsflixPlayer.AppImage)**, make it executable (`chmod +x MitsflixPlayer.AppImage`) and open it. The AppImage updates itself.

## ✨ Features

- **Live TV** with categories, channel logos, search and what's on now and next
- **Movies** with posters, ratings, plots, cast and trailers
- **Series** with seasons and episodes, and resume where you left off
- **Continue watching**, **favourites** and **recent channels** on Home
- **Search** across channels, movies and series
- Any playlist: **Xtream Codes** login or **M3U** link, and more than one playlist
- **Downloads**: save movies, episodes or a whole season to your PC and watch without internet, with pause and resume
- **Record live TV** now, for a set length, at a set time or from the guide, and keep watching the channel while it records
- **Subtitles** for any movie or episode: use the ones in the stream, your own subtitle file, or find them online with a free OpenSubtitles account, and fix the timing if they're early or late
- Full-screen player with keyboard shortcuts and a choice of audio tracks where the stream has them
- Gold Mitsflix look, automatic updates

**Keyboard:** Space play/pause · ← → skip 10s · ↑ ↓ volume (change channel on Live TV) · F full screen · M mute · N next episode · Esc close

## 🍿 Get a playlist

New to Mitsflix? Get your playlist at **[mitsflix.com](https://mitsflix.com)**.

---

<sub>Mitsflix Player is a player only: it doesn't include any channels, playlists or subscriptions.</sub>

<details><summary><sub>Releasing an update (maintainers)</sub></summary>

Raise `version` in `package.json`, write what's new for customers in `notes/v<version>.md`, and push to `main`. The notes appear on the release and in the Discord app-updates post. GitHub Actions builds the installer and publishes it as a release; installed copies update themselves.
</details>
