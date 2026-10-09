const path = require('node:path');

function pick(row, fields) {
  return Object.fromEntries(fields.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]));
}
const mediaFields = ['id','title','type','description','year','genre','file_size','duration','created_at','transcode_status','download_status','hls_available','watchProgress','subtitles','audio_tracks'];
const episodeFields = ['id','series_id','season_number','episode_number','title','description','file_size','duration','transcode_status','hls_available','watchProgress','subtitles','audio_tracks'];
const trackFields = ['id','album_id','track_number','title','artist','duration','file_size','created_at','playback_status','playback_error','position','added_at','favorited_at','entry_id','added_by','queue_position','added_by_name'];
const albumFields = ['id','title','artist','description','genre','year','created_at','updated_at','track_count','total_duration'];
const playlistFields = ['id','user_id','name','description','created_at','updated_at','track_count','total_duration'];
const historyFields = ['id','user_id','media_id','episode_id','progress_seconds','completed','updated_at','title','type','duration','episode_title','season_number','episode_number'];
const partyFields = ['id','host_user_id','media_id','episode_id','position','is_playing','invite_code','created_at','media_title','media_type','media_hls_available','episode_hls_available','episode_title'];

function publicEpisode(row) {
  return { ...pick(row, episodeFields), has_file: !!row.file_path, hls_available: !!row.file_path?.endsWith('.m3u8') };
}
function publicMedia(row) {
  const result = { ...pick(row, mediaFields), has_file: !!row.file_path, has_poster: !!row.poster_path, has_backdrop: !!row.backdrop_path, hls_available: !!row.file_path?.endsWith('.m3u8') };
  if (row.seasons) result.seasons = Object.fromEntries(Object.entries(row.seasons).map(([season, episodes]) => [season, episodes.map(publicEpisode)]));
  return result;
}
function publicTrack(row) {
  const format = path.extname(row.file_path || '').slice(1).toLowerCase();
  return { ...pick(row, trackFields), has_cover: !!row.cover_path, has_playback: !!row.playback_path, audio_format: format };
}
function publicAlbum(row) {
  const result = { ...pick(row, albumFields), has_cover: !!row.cover_path };
  if (row.tracks) result.tracks = row.tracks.map(publicTrack);
  return result;
}
function publicPlaylist(row) {
  const result = { ...pick(row, playlistFields), has_cover: !!row.cover_path };
  if (row.tracks) result.tracks = row.tracks.map(publicTrack);
  return result;
}
function publicHistory(row) {
  return { ...pick(row, historyFields), has_poster: !!row.poster_path, has_backdrop: !!row.backdrop_path };
}
function publicParty(row) {
  return { ...pick(row, partyFields), has_poster: !!row.poster_path };
}
module.exports = { publicMedia, publicEpisode, publicTrack, publicAlbum, publicPlaylist, publicHistory, publicParty };
