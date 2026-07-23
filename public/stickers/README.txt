表情包图片放置说明
====================

把你的表情包图片放到本目录（public/stickers/）下。

文件名要和 stickers.json 里每个表情包的 "file" 字段一致，例如：
  happy.png、laugh.png、love.png、shy.png、sad.png、cry.png、
  angry.png、surprised.png、thinking.png、wink.png、cool.png、sleepy.png

支持 png / jpg / gif / webp，改扩展名时记得同步改 stickers.json 里的 "file"。

想增删表情包：编辑 stickers.json，增删对应条目并放好图片即可，
其中 "emotion" 字段告诉 AI 这个表情包代表什么情绪、该在什么时候发。
建议用中文描述情绪，越贴切 AI 选得越准。

图片建议正方形、边长 128~256px，背景透明的 png 效果最好。
缺失的图片不会报错，只是聊天里显示不出那张图。
