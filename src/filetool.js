// create_file 工具定义：让 AI 在用户明确要文件时，把内容打包成可下载的 txt/md。

/**
 * 构造暴露给模型的 create_file 工具。
 * 仅支持 txt / md 两种文本格式。
 */
export function buildFileTool() {
  return {
    type: 'function',
    function: {
      name: 'create_file',
      description:
        '把一段文本内容生成为可下载的文件（仅支持 txt 或 md 格式）。' +
        '只有当用户明确要求"发文件""导出文件""保存成文件/文档""给我个 txt/md"之类时才调用；' +
        '普通问答请照常用文字回复，不要动不动就生成文件。' +
        '调用后系统会给用户一个下载卡片，你可以再用一句话简短说明。',
      parameters: {
        type: 'object',
        properties: {
          filename: {
            type: 'string',
            description: '文件名（可不带扩展名），简洁描述内容，如"会议纪要"。',
          },
          content: {
            type: 'string',
            description: '文件的完整文本内容。md 格式可用 Markdown 语法。',
          },
          format: {
            type: 'string',
            enum: ['txt', 'md'],
            description: '文件格式：纯文本用 txt，含标题/列表等排版用 md。',
          },
        },
        required: ['filename', 'content'],
      },
    },
  };
}
