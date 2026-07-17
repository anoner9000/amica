import type { NextApiRequest, NextApiResponse } from 'next';
import { AtomicPersistenceError, writeFile } from '@/features/externalAPI/utils/apiHelper';
import { chatLogsFilePath, configRevision, ConfigConflictError, ConfigValidationError, handleGetChatLogs, handleGetConfig, handleGetLogs, handleGetSubconscious, handleGetUserInputMessages, handlePostChatLogs, handlePostConfig, handlePostLogs, handlePostSubconscious, handlePostUserInputMessages, logsFilePath, subconsciousFilePath, userInputMessagesFilePath } from '@/features/externalAPI/dataHelper';

export const CONFIG_REVISION_HEADER = 'x-config-revision';

// Clear data on startup
writeFile(subconsciousFilePath, []);
writeFile(logsFilePath, []);
writeFile(userInputMessagesFilePath, []);
writeFile(chatLogsFilePath, []);

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { type } = req.query;

  if (!['config', 'subconscious', 'logs', 'userInputMessages', 'chatLogs'].includes(type as string)) {
    return res.status(400).json({ error: 'Invalid type parameter' });
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGetRequest(type as string, res);
      case 'POST':
        return handlePostRequest(type as string, req, res);
      default:
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    if (error instanceof AtomicPersistenceError) {
      return res.status(500).json({
        error: error.message,
        code: error.targetReplaced
          ? 'CONFIG_DURABILITY_UNCONFIRMED'
          : 'CONFIG_PERSISTENCE_FAILED',
        phase: error.phase,
        targetReplaced: error.targetReplaced,
      });
    }
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

const handleGetRequest = (type: string, res: NextApiResponse) => {
    let data;
    switch (type) {
      case 'config':
        data = handleGetConfig();
        res.setHeader(CONFIG_REVISION_HEADER, configRevision());
        break;
      case 'subconscious':
        data = handleGetSubconscious();
        break;
      case 'logs':
        data = handleGetLogs();
        break;
      case 'userInputMessages':
        data = handleGetUserInputMessages();
        break;
      case 'chatLogs':
        data = handleGetChatLogs();
        break;
      default:
        return res.status(400).json({ error: 'Invalid type' });
    }
    res.status(200).json(data);
  };
  
  const handlePostRequest = (type: string, req: NextApiRequest, res: NextApiResponse) => {
    const { body } = req;
    let response;

    switch (type) {
      case 'config': {
        const clientRevision = req.headers[CONFIG_REVISION_HEADER];
        try {
          response = handlePostConfig(
            body,
            typeof clientRevision === 'string' ? clientRevision : undefined,
          );
        } catch (error) {
          if (error instanceof ConfigConflictError) {
            res.setHeader(CONFIG_REVISION_HEADER, error.currentRevision);
            return res
              .status(409)
              .json({ error: error.message, revision: error.currentRevision });
          }
          if (error instanceof ConfigValidationError) {
            return res.status(400).json({ error: error.message });
          }
          throw error;
        }
        res.setHeader(CONFIG_REVISION_HEADER, (response as any).revision);
        break;
      }
      case 'subconscious':
        response = handlePostSubconscious(body);
        break;
      case 'userInputMessages':
        response = handlePostUserInputMessages(body);
        break;
      case 'logs':
        response = handlePostLogs(body);
        break;
      case 'chatLogs':
        response = handlePostChatLogs(body);
        break;
      default:
        return res.status(400).json({ error: 'Invalid type' });
    }
  
    res.status(200).json(response);
  };
