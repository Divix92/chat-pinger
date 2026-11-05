'use strict';
function parseChannel(input) {
  if (typeof input !== 'string') throw new Error('Paste a Kick channel link or channel name.');
  let value = input.trim();
  if (!value) throw new Error('Paste a Kick channel link or channel name.');
  if (/^(?:https?:\/\/|(?:www\.)?kick\.com\/)/i.test(value)) {
    let url;
    try { url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); } catch { throw new Error('Invalid channel link.'); }
    if (url.protocol !== 'https:' || !['kick.com', 'www.kick.com'].includes(url.hostname) || url.port || url.username || url.password) {
      throw new Error('Use an https://kick.com/channel link.');
    }
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 1) throw new Error('Use the channel page link, for example https://kick.com/your-channel.');
    value = parts[0];
  }
  if (!/^[a-zA-Z0-9_-]{1,50}$/.test(value)) throw new Error('Channel names can contain letters, numbers, underscores and hyphens.');
  if (['browse','categories','search','settings','login','signup','dashboard','api'].includes(value.toLowerCase())) throw new Error('That is a Kick page, not a channel.');
  return value.toLowerCase();
}
module.exports = { parseChannel };
