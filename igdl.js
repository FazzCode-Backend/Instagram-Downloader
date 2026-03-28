const axios = require('axios');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Konfigurasi
const API_URL = 'https://api.savefromins.com/api/contentsite_api/media/parse';
const AUTH_KEY = '20250901majwlqo';

// Buat interface untuk input command line
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Parse URL Instagram dan dapatkan data download
 * @param {string} instagramUrl - URL Instagram (reel, post, atau story)
 * @returns {Promise<Object>} - Data response dari API
 */
async function fetchInstagramData(instagramUrl) {
  try {
    const requestData = new URLSearchParams();
    requestData.append('auth', AUTH_KEY);
    requestData.append('domain', 'api-ak.savefromins.com');
    requestData.append('origin', 'source');
    requestData.append('link', instagramUrl);

    const response = await axios.post(API_URL, requestData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (response.data.status === 1) {
      return response.data.data;
    } else {
      throw new Error(`API Error: ${response.data.status_code || 'Unknown error'}`);
    }
  } catch (error) {
    throw new Error(`Failed to fetch data: ${error.message}`);
  }
}

/**
 * Download file dari URL
 * @param {string} url - URL file yang akan diunduh
 * @param {string} filepath - Path tujuan penyimpanan
 * @returns {Promise<void>}
 */
async function downloadFile(url, filepath) {
  const writer = fs.createWriteStream(filepath);
  
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const totalLength = response.headers['content-length'];
    let downloadedLength = 0;

    response.data.on('data', (chunk) => {
      downloadedLength += chunk.length;
      if (totalLength) {
        const percent = ((downloadedLength / totalLength) * 100).toFixed(2);
        process.stdout.write(`\rDownloading: ${percent}%`);
      }
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log(`\n✅ Downloaded: ${path.basename(filepath)}`);
        resolve();
      });
      writer.on('error', reject);
      response.data.on('error', reject);
    });
  } catch (error) {
    throw new Error(`Download failed: ${error.message}`);
  }
}

/**
 * Membersihkan nama file dari karakter yang tidak valid
 * @param {string} filename - Nama file yang akan dibersihkan
 * @returns {string} - Nama file yang sudah dibersihkan
 */
function sanitizeFilename(filename) {
  return filename
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);
}

/**
 * Menampilkan informasi media dan memilih kualitas
 * @param {Object} mediaData - Data media dari API
 * @returns {Promise<Array>} - Daftar URL yang akan diunduh
 */
async function selectMediaToDownload(mediaData) {
  console.log('\nMedia Information:');
  console.log(`Title: ${mediaData.title || 'No title'}`);
  console.log(`Type: ${mediaData.media[0]?.type || 'Unknown'}`);
  console.log(`Likes: ${mediaData.like_count || 0}`);
  console.log(`Comments: ${mediaData.comment_count || 0}`);
  
  if (mediaData.media && mediaData.media.length > 0) {
    console.log('\n📋 Available Downloads:');
    
    mediaData.media.forEach((media, idx) => {
      if (media.type === 'video' && media.resources) {
        console.log(`\n[${idx + 1}] Video (${media.resources.length} qualities available):`);
        media.resources.forEach((resource, ridx) => {
          console.log(`   ${ridx + 1}.${resource.quality} - ${resource.format}`);
        });
      } else if (media.type === 'image') {
        console.log(`\n[${idx + 1}] Image - ${media.resources?.[0]?.quality || 'Original'}`);
      }
    });

    // Tambahkan opsi untuk audio jika ada
    if (mediaData.resources && mediaData.resources.some(r => r.type === 'audio')) {
      console.log(`\n[audio] Audio only (MP3)`);
    }

    console.log('\n Options:');
    console.log('   - Enter number to download specific quality');
    console.log('   - "all" to download all qualities');
    console.log('   - "best" to download highest quality');
    console.log('   - "audio" to download audio only');

    return new Promise((resolve) => {
      rl.question('\n Choose option: ', async (answer) => {
        const urlsToDownload = [];
        
        if (answer === 'all') {
          // Download semua kualitas
          mediaData.media.forEach(media => {
            if (media.type === 'video' && media.resources) {
              media.resources.forEach(resource => {
                if (resource.download_url) {
                  urlsToDownload.push({
                    url: resource.download_url,
                    filename: `${sanitizeFilename(mediaData.title)}_${resource.quality}.${resource.format}`,
                    quality: resource.quality
                  });
                }
              });
            }
          });
        } else if (answer === 'best') {
          // Download kualitas tertinggi
          const videoMedia = mediaData.media.find(m => m.type === 'video');
          if (videoMedia && videoMedia.resources) {
            const bestQuality = videoMedia.resources[0];
            if (bestQuality.download_url) {
              urlsToDownload.push({
                url: bestQuality.download_url,
                filename: `${sanitizeFilename(mediaData.title)}_${bestQuality.quality}.${bestQuality.format}`,
                quality: bestQuality.quality
              });
            }
          }
        } else if (answer === 'audio') {
          // Download audio
          const audioResource = mediaData.resources?.find(r => r.type === 'audio');
          if (audioResource && audioResource.download_url) {
            urlsToDownload.push({
              url: audioResource.download_url,
              filename: `${sanitizeFilename(mediaData.title)}_audio.mp3`,
              quality: 'audio'
            });
          }
        } else if (!isNaN(answer) && answer > 0) {
          // Download kualitas spesifik
          const selectedIdx = parseInt(answer) - 1;
          const selectedMedia = mediaData.media[selectedIdx];
          
          if (selectedMedia && selectedMedia.type === 'video' && selectedMedia.resources) {
            // Jika video, pilih kualitas
            console.log('\nAvailable qualities:');
            selectedMedia.resources.forEach((resource, idx) => {
              console.log(`   ${idx + 1}. ${resource.quality}`);
            });
            
            rl.question('Select quality number: ', (qualityAnswer) => {
              const qualityIdx = parseInt(qualityAnswer) - 1;
              if (qualityIdx >= 0 && qualityIdx < selectedMedia.resources.length) {
                const resource = selectedMedia.resources[qualityIdx];
                if (resource.download_url) {
                  urlsToDownload.push({
                    url: resource.download_url,
                    filename: `${sanitizeFilename(mediaData.title)}_${resource.quality}.${resource.format}`,
                    quality: resource.quality
                  });
                }
              }
              resolve(urlsToDownload);
            });
            return;
          } else if (selectedMedia && selectedMedia.resources?.[0]?.download_url) {
            urlsToDownload.push({
              url: selectedMedia.resources[0].download_url,
              filename: `${sanitizeFilename(mediaData.title)}_${selectedMedia.resources[0].quality || 'original'}.${selectedMedia.resources[0].format || 'jpg'}`,
              quality: selectedMedia.resources[0].quality || 'original'
            });
          }
        }
        
        resolve(urlsToDownload);
      });
    });
  }
  
  return [];
}

/**
 * Fungsi utama
 */
async function main() {
  console.log(' Instagram Downloader (via savefromins.com)\n');
  
  rl.question('Masukkan URL Instagram: ', async (url) => {
    try {
      // Validasi URL
      if (!url.includes('instagram.com')) {
        console.log(' Invalid Instagram URL!');
        rl.close();
        return;
      }
      
      console.log('\n Fetching media data...');
      const mediaData = await fetchInstagramData(url);
      
      if (!mediaData.media || mediaData.media.length === 0) {
        console.log(' No media found!');
        rl.close();
        return;
      }
      
      const urlsToDownload = await selectMediaToDownload(mediaData);
      
      if (urlsToDownload.length === 0) {
        console.log(' No valid download URL found!');
        rl.close();
        return;
      }
      
      // Buat folder downloads jika belum ada
      const downloadDir = path.join(__dirname, 'downloads');
      if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir);
      }
      
      console.log(`\nDownloading ${urlsToDownload.length} file(s)...\n`);
      
      // Download semua file
      for (const item of urlsToDownload) {
        const filepath = path.join(downloadDir, item.filename);
        try {
          await downloadFile(item.url, filepath);
        } catch (error) {
          console.log(`\nFailed to download ${item.filename}: ${error.message}`);
        }
      }
      
      console.log('\nAll downloads completed!');
      console.log(` Files saved in: ${downloadDir}`);
      
    } catch (error) {
      console.error(`\nError: ${error.message}`);
    } finally {
      rl.close();
    }
  });
}

// Jalankan main function
main();
