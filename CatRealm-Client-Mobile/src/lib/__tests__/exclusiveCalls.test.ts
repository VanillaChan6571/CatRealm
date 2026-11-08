import { leaveOtherCalls, registerCallLeaver } from '../exclusiveCalls';

describe('exclusiveCalls', () => {
  it('leaves the other kind of call, not the one being joined', () => {
    const leaveVoice = jest.fn();
    const leaveTheater = jest.fn();
    registerCallLeaver('voice', leaveVoice);
    registerCallLeaver('theater', leaveTheater);

    leaveOtherCalls('voice');
    expect(leaveVoice).not.toHaveBeenCalled();
    expect(leaveTheater).toHaveBeenCalledTimes(1);

    leaveOtherCalls('theater');
    expect(leaveVoice).toHaveBeenCalledTimes(1);
    expect(leaveTheater).toHaveBeenCalledTimes(1);
  });
});
